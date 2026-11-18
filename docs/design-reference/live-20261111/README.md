# Running Deck design reference

Captured from the actual running [Deck workspace](http://127.0.0.1:7421/) on 2026-11-11. These are live application captures, not the earlier projected shell fixture. The [provenance record](provenance.json) contains viewport, theme, font, browser version, image hashes, served asset hashes and the running executable hash. Repository HEAD is recorded separately; equality with the running build is not assumed.

| View | Dark | Light |
|---|---|---|
| Desktop home, 1440 × 1000 | [Image](desktop-dark-home.png) | [Image](desktop-light-home.png) |
| Desktop appearance settings | [Image](desktop-dark-settings.png) | [Image](desktop-light-settings.png) |
| Mobile home, 390 × 844 | [Image](mobile-dark-home.png) | [Image](mobile-light-home.png) |
| Mobile navigation | [Image](mobile-dark-navigation.png) | [Image](mobile-light-navigation.png) |
| Mobile appearance settings | [Image](mobile-dark-settings.png) | [Image](mobile-light-settings.png) |

Use these references for the navigation density, header, panel proportions, typography, brand, surfaces, settings composition and responsive behavior. Match the viewport, theme and system font when comparing new captures. The desktop split preference was 50%. Do not add inert controls or fabricated data to mimic capabilities before their implementation exists.

Separate ephemeral browser contexts were used, with reduced motion. No private conversation was selected, message sent, or administrative control applied. Normal page initialization included local-access authentication and push-presence requests; preferences stayed in the capture contexts. Dynamic project names, counts and usage are incidental content, not pixel comparison oracles. There were no page exceptions in the successful ten-capture run.

These still images do not qualify animations or conversation/approval/streaming states. Capture those states as their corresponding sprint becomes active, using local masking or a controlled session where needed to preserve privacy. The supplementary reproduction script is `target/live-design-reference/capture.cjs`; retained reference images and provenance live outside build output.
