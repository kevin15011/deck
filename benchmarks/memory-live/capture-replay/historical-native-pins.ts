/** Historical replay only, recovered verbatim from immutable adapter manifests.
 * No current-plugin acceptance claim. Hashes below were copied from Git, then
 * checked against retained fixture bytes; they were not recomputed to bless them.
 */
export const HISTORICAL_SOURCE_COMMIT = "6c460230a89c38c1ca2c9cd67a249a4ff20b04f0";
export const HISTORICAL_SOURCES = {
  "claude": {
    "path": "packages/adapter-claude/src/supermemory-artifact.ts",
    "blob": "a09bfbf733f5a06de5418a3ec57569acddf366a6",
    "sha256": "90ab69bc89e29b7369f1402ebd87acb50e9c35ebb280f1204e31ee4b2e1b69cd"
  },
  "codex": {
    "path": "packages/adapter-codex/src/supermemory-artifact.ts",
    "blob": "eaa9d2565ce4500637e66c433887e50818ed52f7",
    "sha256": "8346cc8bf296c6d77d7f2ad8dc60f49b33371cd7215087ab0598bd654e37477c"
  },
  "opencode": {
    "path": "packages/adapter-opencode/src/opencode-supermemory-plugin.ts",
    "blob": "9cfe485cb92beeb19a4ce36ff34530dfeb0be707",
    "sha256": "d1e1f3ce4e5f828b41f1ab6f0940adcf8de37229fc3afea4f22e9066e73ec7b8"
  }
} as const;
export const HISTORICAL_NATIVE = {
  "claude": {
    "version": "915aba1b8056ddb3630fa833973032ba6b788fdb",
    "entries": [
      [
        ".claude-plugin/plugin.json",
        "3183a8b64a1c79b50e808cfb66453cfac9f4bd28bcfbc3a0e97a20a038af1c9f",
        546
      ],
      [
        ".mcp.json",
        "d65e1e806f31a0debdcf4af7e2f5411123554d5b915e650b973aa7b42e1e58b9",
        107
      ],
      [
        "agents/context-gatherer.md",
        "e68b5da5cd983f70da143908733ceadcea73553e2b0e505986d2318356203299",
        2480
      ],
      [
        "commands/index.md",
        "69cac15efbda7cb302dd9fb1758f2a40f1efd17ba65b85635dd7ea69f28eb833",
        9479
      ],
      [
        "commands/status.md",
        "4fa32e0b1ce8247854857d4783578125b5952ad019c7975b36bc3a46ac69ef88",
        1516
      ],
      [
        "hooks/capture.js",
        "3cd1e3f504e1a38f186a0755eb074de9fa06d505622848901a2403b9af58c566",
        2967
      ],
      [
        "hooks/hooks.json",
        "bffe993fa75b47879e2b5a14f94822e7f9d2a0bff78f2e65572ba66ee298e8ed",
        1255
      ],
      [
        "hooks/lib/api.js",
        "a4e99eb9a6b58992da1528c799c9fd74917277b5fe2e32c286d99143cacd4673",
        2786
      ],
      [
        "hooks/lib/auth.js",
        "75e7240e54a03b450de5438f7bc086806e0f9804fba7e1e8cf7f91bc77304be4",
        3866
      ],
      [
        "hooks/lib/colors.js",
        "bf71b0b97199ca980c80063af1c8e8c7cdfd7a9680e1cb5e50b2c7bcd6b4dbbe",
        642
      ],
      [
        "hooks/lib/container-tag.js",
        "c6b9f2d1e8d36d2e292a95acb8760db85bfa521a144413b10a8235c92210ecf3",
        3894
      ],
      [
        "hooks/lib/error-helpers.js",
        "a92ac1a4beea2956f3ca095ef908f463d9c354282f855503574b097417189e67",
        2620
      ],
      [
        "hooks/lib/git-utils.js",
        "728cfe3621df9dc3965039f632b36678d9244322b69c147fa18cac918d6cb6dc",
        1297
      ],
      [
        "hooks/lib/last-session.js",
        "107974aabbf3fc03ef82b73ea306308c7ca51fc5607df3ea85a84f270b1f65ea",
        1079
      ],
      [
        "hooks/lib/project-config.js",
        "29aaa6e6d88e7dd3ce9e41a2d42106813defca9630beb2544237843db8a741da",
        1169
      ],
      [
        "hooks/lib/settings.js",
        "052921416fde24daaea8e5670d3eeda5c862ee448d0bab9732150bfee40a9415",
        4212
      ],
      [
        "hooks/lib/statusline-state.js",
        "dc0678ea304a93954fd3a29cf922dcad2ce0f28ea920a4db3e6ec7ab9e805dfb",
        5293
      ],
      [
        "hooks/lib/stdin.js",
        "2d6b90c06e5cdb8d7ef552876eb34221776152573bf17ec5379038a00387ac77",
        1599
      ],
      [
        "hooks/lib/transcript.js",
        "59daec5071dc21edba512884ed0837a5b026849f5ffa011f72150de0150dae35",
        13441
      ],
      [
        "hooks/mcp-proxy.js",
        "ea43d976479acc75e2f64adf86babbf6e1858495df4da2d7746b433102a9a39d",
        4117
      ],
      [
        "hooks/recall-approve.js",
        "fa194e80da38f3981e958a627fa2f069944dee0d686c00a80b782af9346b4e01",
        2220
      ],
      [
        "hooks/recall-directive.js",
        "1ae2d53fb96e7998d51fc67b698f936437764912c35c8f5543d7cfaf7f6d11d9",
        9415
      ],
      [
        "hooks/session-start.js",
        "c6bb4a6953426ff21db367991575bf17527cc2303024ae14de86a3f9dffae4b0",
        9388
      ],
      [
        "hooks/templates/auth-error.html",
        "1d333704c9346d99ace6ad354bd085780ff7487b1feb496adb9b07353c99b531",
        940
      ],
      [
        "hooks/templates/auth-success.html",
        "916a18ebcd3ca8d6164f59a44af0f28e831b73fd21610ca252774bc4109e42e2",
        148739
      ],
      [
        "statusline.js",
        "c9c99eb8f32f52b3d059ffd1c9e991946ee24b87f2d0a31067391ab9f3d882ef",
        8852
      ]
    ]
  },
  "codex": {
    "version": "1.0.19",
    "entries": [
      [
        "recall.js",
        "62d5c106fd4537accbc6241ed51d79c455821f31cc74ff6fcde44aab66877f1a",
        34443
      ],
      [
        "flush.js",
        "b146633584cd90d7616cd616d32abadce3c6d9ceb88ef28b19541effe851ef34",
        111541
      ]
    ]
  },
  "opencode": {
    "version": "2.0.15",
    "entries": [
      [
        "package.json",
        "d8efdecc9b36b04104bac1f14bc7a24ea51efd142e356c925126a9519ed6e69a"
      ],
      [
        "dist/index.js",
        "7609aae38efb0f07a39759cab404e28b02d1e31e5d601a012f6efd83b202d1a7"
      ],
      [
        "dist/server.js",
        "37e56a4860f41c7a51a1dfecff3b750c7442f3748a410e32ac56de6eda9a3414"
      ]
    ]
  }
} as const;
export function historicalOpenCodeLoader(): string {
  return [
    'import { SupermemoryPlugin } from "./node_modules/opencode-supermemory/dist/index.js";',
    'import ServerPlugin from "./node_modules/opencode-supermemory/dist/server.js";',
    "",
    "export default Object.freeze({",
    '  id: "opencode-supermemory",',
    "  server: (ctx) => SupermemoryPlugin(ctx),",
    "  setup: ServerPlugin.setup,",
    "});",
    "",
  ].join("\n");
}
