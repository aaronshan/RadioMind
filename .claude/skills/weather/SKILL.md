# Weather

## Description
Provide current weather information to recommend contextually appropriate music.

## Data Paths
- Weather data is fetched from Open-Meteo API at runtime
- Current weather is cached and refreshed every 10 minutes

## Usage Guidelines
- Use weather to influence music recommendations:
  - Sunny/Clear → Energetic, upbeat music
  - Rainy/Cloudy → Chill, atmospheric, acoustic
  - Cold/Snow → Warm, comforting music
- Combine with time of day for better recommendations
