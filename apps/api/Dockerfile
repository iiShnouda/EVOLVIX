# SKB API — production container (ASP.NET Core 10).
# Build context is apps/api (see render.yaml dockerContext).

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore first (cached layer) then build.
COPY src/SKB.Api/SKB.Api.csproj src/SKB.Api/
RUN dotnet restore src/SKB.Api/SKB.Api.csproj

COPY src/ src/
RUN dotnet publish src/SKB.Api/SKB.Api.csproj -c Release -o /app /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app ./
ENV ASPNETCORE_ENVIRONMENT=Production
# Cloud hosts inject $PORT; the app honors it (see Program.cs). 8080 is the local default.
EXPOSE 8080
ENTRYPOINT ["dotnet", "SKB.Api.dll"]
