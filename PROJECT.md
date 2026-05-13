# Curling Release Tracker MVP

This is a mobile-first MVP web app for curling players to track and analyze release times during training.

## MVP Version 0.1

The app works without backend, login or database. Data is stored locally in the browser.

## Core Features

- Create a training session
- Define a target release time
- Enter release times quickly on mobile
- Select handle: In or Out
- Select shot type
- Add optional comments
- Store sessions locally
- Analyze session performance

## Analytics

The app should calculate:

- Average release time
- Median release time
- Deviation from target time
- Average absolute deviation from target
- Standard deviation
- Min and max release time
- Outliers
- In vs Out handle comparison
- Trend over shot number

## UX Principles

- Mobile-first
- Fast input during practice
- Large buttons
- Minimal typing
- Clear feedback
- No unnecessary complexity

## Tech Stack

- Next.js
- TypeScript
- Tailwind CSS
- Recharts
- LocalStorage