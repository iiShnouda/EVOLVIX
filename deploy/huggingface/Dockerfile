# syntax=docker/dockerfile:1.4
# SKB — Hugging Face Space Dockerfile. Paste this as the "Dockerfile" of a new Docker Space.
# It clones the PRIVATE repo with a read-only token (set GH_TOKEN as a Space secret), builds
# the web app + the C# API, and serves both on one port (7860). Your PC is never involved.

# 1) Build the web app (relative "/api", served same-origin by the API).
FROM node:22-alpine AS web
RUN apk add --no-cache git && corepack enable
WORKDIR /src
RUN --mount=type=secret,id=GH_TOKEN \
    git clone --depth 1 "https://x-access-token:$(cat /run/secrets/GH_TOKEN)@github.com/iiShnouda/SKB.git" .
RUN pnpm install --frozen-lockfile=false \
 && pnpm --filter @skb/shared build \
 && pnpm --filter @skb/web build

# 2) Publish the API (reuse the cloned source from the web stage).
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
COPY --from=web /src/apps/api/src/SKB.Api/SKB.Api.csproj apps/api/src/SKB.Api/
RUN dotnet restore apps/api/src/SKB.Api/SKB.Api.csproj
COPY --from=web /src/apps/api/src apps/api/src
RUN dotnet publish apps/api/src/SKB.Api/SKB.Api.csproj -c Release -o /app /p:UseAppHost=false

# 3) Final image: API + web in wwwroot, listening on the HF port (7860).
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=api /app ./
COPY --from=web /src/apps/web/dist ./wwwroot
ENV ASPNETCORE_ENVIRONMENT=Production
ENV PORT=7860
EXPOSE 7860
ENTRYPOINT ["dotnet", "SKB.Api.dll"]
