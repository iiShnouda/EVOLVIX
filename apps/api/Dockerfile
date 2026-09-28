# SKB — single production container: the C# API also serves the built web app.
# Build context is the REPO ROOT (see render.yaml). Result is ONE service on ONE URL.

# 1) Build the web app (relative "/api", so it's served same-origin by the API).
FROM node:22-alpine AS web
RUN corepack enable
WORKDIR /src
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile=false
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @skb/shared build && pnpm --filter @skb/web build

# 2) Build/publish the API.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
COPY apps/api/src/SKB.Api/SKB.Api.csproj apps/api/src/SKB.Api/
RUN dotnet restore apps/api/src/SKB.Api/SKB.Api.csproj
COPY apps/api/src apps/api/src
RUN dotnet publish apps/api/src/SKB.Api/SKB.Api.csproj -c Release -o /app /p:UseAppHost=false

# 3) Final image: API + the web app in wwwroot.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=api /app ./
COPY --from=web /src/apps/web/dist ./wwwroot
ENV ASPNETCORE_ENVIRONMENT=Production
# Cloud hosts inject $PORT (honored in Program.cs); 8080 is the local default.
EXPOSE 8080
ENTRYPOINT ["dotnet", "SKB.Api.dll"]
