import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ["src/index.ts"],
    format: "cjs",
    platform: "node",
    target: "es2022",
    outDir: "lib",
    dts: true,
    sourcemap: true,
    clean: true,
    fixedExtension: false,
    deps: {
        neverBundle: [
            "koishi-plugin-yesimbot",
            "koishi",
            "ws",
            "@msgpack/msgpack",
            "undici",
            "uuid",
        ],
    },
});
