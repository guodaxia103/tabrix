FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC
ENV CHROME_MCP_NODE_PATH=/usr/bin/node

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg xdg-utils \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-linux.gpg \
  && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-linux.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get update \
  && apt-get install -y --no-install-recommends nodejs google-chrome-stable \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY . /workspace

RUN corepack enable && corepack prepare pnpm@10.22.0 --activate

RUN chmod +x /workspace/docker/ubuntu-self-check/run-self-check.sh

CMD ["/workspace/docker/ubuntu-self-check/run-self-check.sh"]

