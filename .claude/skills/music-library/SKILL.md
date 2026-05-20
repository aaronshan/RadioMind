# Music Library

## Description
Access user's music collection, playlists, and taste preferences for personalized song recommendations.

## Data Paths

### Primary Data
- **Playlists**: `user/playlists.json` - Contains all songs from NetEase and QQ Music
- **Taste Profile**: `user/taste.md` - Auto-generated taste analysis
- **Routines**: `user/routines.md` - User's daily schedule and music preferences
- **Mood Rules**: `user/mood-rules.md` - Music matching rules for different moods

### Collection Data Structure
The `playlists.json` contains:
- `platforms.netease-local.likedSongs` - NetEase "I like" songs
- `platforms.netease-local.playlists` - User's custom playlists
- `platforms.qqmusic-local.likedSongs` - QQ Music "I like" songs
- `platforms.qqmusic-local.playlists` - User's custom playlists

## Usage Guidelines
- Prioritize songs from `likedSongs` collections
- Consider user's daily schedule from `routines.md`
- Match music to weather/mood based on `mood-rules.md`
- Reference `taste.md` for artist and genre preferences
