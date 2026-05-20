# Calendar

## Description
Access user's calendar/events to recommend music matching their current activity state.

## Data Paths (User Implementation Required)

Choose one of the following methods:

### Option 1: ICS File Sync
- **Path**: `user/calendar.ics`
- Sync your calendar to this ICS file periodically

### Option 2: API Endpoint
- Configure in environment: `CALENDAR_API_ENDPOINT`
- Requires authentication setup by user

### Option 3: Manual Status
- **Path**: `user/calendar-status.json`
- User manually updates current activity state

## Usage Guidelines
Match music to calendar events:
- **Meeting/Focus time** → Instrumental, lo-fi, no vocals
- **Break/Relax** → User's preferred genres
- **Exercise** → High energy, rhythmic
- **Commute** → Podcasts or user's choice

## TODO (User Implementation)
User needs to implement their own calendar data source based on their internal system (Google Calendar, Outlook, etc.)
