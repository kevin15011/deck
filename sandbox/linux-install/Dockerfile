FROM node:24-bookworm-slim
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl git procps unzip xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash tester
ENV HOME=/home/tester
ENV PATH=/home/tester/.local/bin:/home/tester/.npm-global/bin:$PATH
USER tester
WORKDIR /home/tester
RUN mkdir -p .local/bin .npm-global project && git -C project init -q
ENV NPM_CONFIG_PREFIX=/home/tester/.npm-global
# Explicit refresh invalidates runner downloads without discarding Linux layers.
ARG RUNNER_REFRESH=initial
RUN echo "Runner refresh: ${RUNNER_REFRESH}" \
    && npm install --global --allow-scripts=opencode-ai opencode-ai@latest @openai/codex@latest \
    && curl -fsSL https://claude.ai/install.sh -o /tmp/claude-install.sh \
    && bash /tmp/claude-install.sh stable \
    && rm /tmp/claude-install.sh \
    && npm cache clean --force \
    && { opencode --version && codex --version && claude --version; } > /home/tester/runner-versions.txt \
    && rm -rf /home/tester/.cache /home/tester/.config /home/tester/.claude /home/tester/.codex
COPY --chown=tester:tester welcome.sh /home/tester/welcome.sh
WORKDIR /home/tester/project
CMD ["bash", "--rcfile", "/home/tester/welcome.sh", "-i"]
