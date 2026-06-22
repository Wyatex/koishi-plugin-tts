import { Context, Schema } from "koishi";
import { ProxyAgent, fetch } from "undici";

import { BaseTTSConfig, BaseTTSParams, SynthesisResult } from "../../types";
import { TTSAdapter } from "../base";

export interface MinimaxVoiceCloneConfig extends BaseTTSConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  proxy?: string;

  /** Reference voice_id. */
  voice_id: string;

  toolDesc: string;
}

export const MinimaxVoiceCloneConfig: Schema<MinimaxVoiceCloneConfig> =
  Schema.object({
    baseURL: Schema.string()
      .default("https://api.minimaxi.com/v1")
      .description("Minimax API 的基础地址"),

    apiKey: Schema.string()
      .role("secret")
      .default("")
      .description("Minimax API Key"),

    model: Schema.string()
      .default("speech-2.8-turbo")
      .description("使用的模型名称"),

    proxy: Schema.string().role("link").description("代理地址"),

    voice_id: Schema.string().description("音色id"),

    toolDesc: Schema.string()
      .role("textarea", { rows: [3, 6] })
      .default(
        `将文本转换为语音。
- 适合生成自然流畅的语音。`
      )
      .description("工具描述文本，用于指导AI使用"),
  }).description("Minimax Voice Clone 配置");

export interface MinimaxVoiceCloneTTSParams extends BaseTTSParams {}

interface MinimaxResponse {
  data: {
    audio: string; // hex格式
  };
}

export class MinimaxVoiceCloneAdapter extends TTSAdapter<
  MinimaxVoiceCloneConfig,
  MinimaxVoiceCloneTTSParams
> {
  public readonly name = "minimax-voiceclone";
  private baseURL: string;

  constructor(ctx: Context, config: MinimaxVoiceCloneConfig) {
    super(ctx, config);

    this.baseURL = config.baseURL.replace(/\/+$/, "");

    this.ctx.logger.info(
      `[minimax-voiceclone] 已加载参考音频: ${config.voice_id}`
    );
  }

  async synthesize(
    params: MinimaxVoiceCloneTTSParams
  ): Promise<SynthesisResult> {
    const {model, voice_id} = this.config
    const body = {
      model,
      text: params.text,
      stream: false,
      voice_setting: {
        voice_id,
      },
    };

    let dispatcher;
    if (this.config.proxy) {
      try {
        dispatcher = new ProxyAgent({ uri: this.config.proxy });
        this.ctx.logger.info(
          `[minimax-voiceclone] using proxy: ${this.config.proxy}`
        );
      } catch (err) {
        // ignore proxy init error
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["Authorization"] = 'Bearer ' + this.config.apiKey;
    }

    const response = await fetch(`${this.baseURL}/t2a_v2`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      dispatcher,
    });

    if (!response.ok) {
      throw new Error(
        `Minimax API 请求失败: ${response.status} ${response.statusText}`
      );
    }

    const result = (await response.json()) as MinimaxResponse;

    const audioBuffer = Buffer.from(result.data.audio, "hex");

    return {
      audio: audioBuffer,
      mimeType: "audio/mp3",
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
