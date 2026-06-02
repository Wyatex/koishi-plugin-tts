import { readFileSync } from "fs";
import { Context, Schema } from "koishi";
import path from "path";
import { ProxyAgent, fetch } from "undici";

import { BaseTTSConfig, BaseTTSParams, SynthesisResult } from "../../types";
import { TTSAdapter } from "../base";

/** Map file extension to MIME type */
const EXT_TO_MIME: Record<string, string> = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
};

function extToMime(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return EXT_TO_MIME[ext] || "audio/wav";
}

export interface MimoVoiceCloneConfig extends BaseTTSConfig {
    baseURL: string;
    apiKey?: string;
    model: string;
    proxy?: string;

    /** Reference audio list — the first entry is used as the voice clone reference. */
    references?: { audio: string; text: string }[];

    toolDesc: string;
}

export const MimoVoiceCloneConfig: Schema<MimoVoiceCloneConfig> = Schema.object({
    baseURL: Schema.string()
        .default("https://api.xiaomimimo.com/v1")
        .description("MIMO API 的基础地址"),

    apiKey: Schema.string()
        .role("secret")
        .default("")
        .description("MIMO API Key"),

    model: Schema.string()
        .default("mimo-v2.5-tts-voiceclone")
        .description("使用的模型名称"),

    proxy: Schema.string()
        .role("link")
        .description("代理地址"),

    references: Schema.array(
        Schema.object({
            audio: Schema.path({ filters: ["file"] })
                .description("参考音频文件路径")
                .required(),
            text: Schema.string()
                .default("")
                .role("textarea", { rows: [1, 2] })
                .description("参考音频对应的文本内容"),
        })
    )
        .description("参考音频列表（首个用作音色克隆参考）")
        .default([]),

    toolDesc: Schema.string()
        .role("textarea", { rows: [3, 6] })
        .default(
            `将文本转换为语音。
- 适合生成自然流畅的语音。`
        )
        .description("工具描述文本，用于指导AI使用"),
}).description("Mimo Voice Clone 配置");

export interface MimoVoiceCloneTTSParams extends BaseTTSParams {}

interface MimoAudioMessage {
    audio: {
        data: string; // base64 encoded wav
    };
}

interface MimoChoice {
    message: MimoAudioMessage;
}

interface MimoResponse {
    choices: MimoChoice[];
}

export class MimoVoiceCloneAdapter extends TTSAdapter<MimoVoiceCloneConfig, MimoVoiceCloneTTSParams> {
    public readonly name = "mimo-voiceclone";
    private voiceDataUri: string | null = null;
    private baseURL: string;

    constructor(ctx: Context, config: MimoVoiceCloneConfig) {
        super(ctx, config);

        this.baseURL = config.baseURL.replace(/\/+$/, "");

        // Read the first reference audio and encode as data URI for voice cloning
        if (config.references && config.references.length > 0) {
            const refer = config.references[0];
            try {
                const audioBuffer = readFileSync(path.join(ctx.baseDir, refer.audio));
                const mime = extToMime(refer.audio);
                const base64 = audioBuffer.toString("base64");
                this.voiceDataUri = `data:${mime};base64,${base64}`;
                this.ctx.logger.info(`[mimo-voiceclone] 已加载参考音频: ${refer.audio}`);
            } catch (err) {
                this.ctx.logger.error(`[mimo-voiceclone] 参考音频读取失败: ${refer.audio}`);
            }
        } else {
            this.ctx.logger.warn("[mimo-voiceclone] 未配置参考音频，无法进行音色克隆");
        }
    }

    async synthesize(params: MimoVoiceCloneTTSParams): Promise<SynthesisResult> {
        if (!this.voiceDataUri) {
            throw new Error("未配置参考音频，无法进行音色克隆");
        }

        const body = {
            model: this.config.model,
            messages: [
                { role: "user", content: "" },
                { role: "assistant", content: params.text },
            ],
            audio: {
                format: "wav",
                voice: this.voiceDataUri,
            },
        };

        let dispatcher;
        if (this.config.proxy) {
            try {
                dispatcher = new ProxyAgent({ uri: this.config.proxy });
                this.ctx.logger.info(`[mimo-voiceclone] using proxy: ${this.config.proxy}`);
            } catch (err) {
                // ignore proxy init error
            }
        }

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (this.config.apiKey) {
            headers["api-key"] = this.config.apiKey;
        }

        const response = await fetch(`${this.baseURL}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            dispatcher,
        });

        if (!response.ok) {
            throw new Error(`MIMO API 请求失败: ${response.status} ${response.statusText}`);
        }

        const result = (await response.json()) as MimoResponse;

        const audioData = result.choices?.[0]?.message?.audio?.data;
        if (!audioData) {
            throw new Error("MIMO API 响应中未找到音频数据");
        }

        const audioBuffer = Buffer.from(audioData, "base64");

        return {
            audio: audioBuffer,
            mimeType: "audio/wav",
        };
    }

    getToolSchema(): Schema {
        return Schema.object({
            text: Schema.string().required().description("要合成的文本内容"),
        });
    }

    public override getToolDescription(): string {
        return this.config.toolDesc;
    }
}
