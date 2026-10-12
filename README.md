# Design2Golf social dashboard

A web page that turns the export files from Matt's Instagram (@mattatkins_d2g), LinkedIn (Design2Golf business page and Matt's personal profile) and YouTube into one dashboard. There are no logins, connectors or tokens to expire. The files you upload are the data.

Live dashboard: **https://dkcpr.github.io/design2golf-dashboard/**

## Weekly routine (about 15 minutes)

### 1. Download the exports

Pick the longest date range each time. Overlapping dates are fine.

| Platform | Where | Files |
|---|---|---|
| **Instagram (Matt)** | business.facebook.com/latest/insights/results → platform box: **@mattatkins_d2g** → date: **Last 90 days** → **Export → CSV** on each card | Views, Viewers, Follows, Visits, Interactions, Link clicks (6 CSVs) |
| **LinkedIn (business)** | Design2Golf company page, admin view → **Analytics → Content → Export**, then **Analytics → Followers → Export** | `…_content_….xls` and `…_followers_….xls` |
| **LinkedIn (Matt)** | Signed in as Matt: **linkedin.com/analytics/creator/content** → longest range → **Export** | One Excel file (it has Engagement, Followers and Top posts sheets) |
| **YouTube** | **studio.youtube.com → Analytics → Overview → See more** (opens Advanced mode) → longest range → **download arrow (↓) → Comma-separated values (.csv)** | A folder of three files. Upload `Totals.csv` (daily views for the whole channel) and `Table data.csv` (one row per video). Skip `Chart data.csv`: it only covers the videos highlighted in the chart. |

Only someone signed in as Matt can export his personal LinkedIn analytics. If that isn't you, ask him to send you the file each week.

### 2. Rename

Put the date at the start of each file name, e.g. `2026-10-18 Views.csv`. Where two files cover the same day, the newer name wins.

### 3. Upload

Open the platform's folder upload page, drag the files in, and click the green **Commit changes** button at the bottom. Nothing is saved until you click it.

- Instagram: github.com/dkcpr/design2golf-dashboard/upload/main/data/instagram
- LinkedIn (business): github.com/dkcpr/design2golf-dashboard/upload/main/data/linkedin
- LinkedIn (Matt): github.com/dkcpr/design2golf-dashboard/upload/main/data/linkedin-personal
- YouTube: github.com/dkcpr/design2golf-dashboard/upload/main/data/youtube

### 4. Check

Wait about 5 minutes, then reload the dashboard. If anything looks stale, press Cmd+Shift+R. Each platform's status box turns green when its data is current and yellow when it's more than 10 days old. A yellow box at the top lists any file that couldn't be read.

Not sure a file will work? Drag it onto the dashboard page first. It previews the file in your browser without uploading anything.

## Numbers no export gives you

Matt's personal LinkedIn export includes his follower total. The Instagram, LinkedIn business and YouTube exports only give *new* followers or subscribers. For their totals, check each profile page about once a month, then open `data/manual/weekly.csv` in GitHub (click the file, then the pencil icon) and add one line:

```
week_start,platform,followers,new_followers,reach,impressions,engagements,posts
2026-10-05,instagram,1234,,,,,
```

`week_start` is that week's Monday. `platform` is `instagram`, `linkedin`, `linkedin-personal` or `youtube`. Leave blanks for anything you don't have. Numbers in this file take priority over the exports.

## Goals

Targets live in `data/manual/goals.csv`, one row per goal. To add or change goals, open the file in GitHub and click the pencil icon:

```
start,end,platform,metric,target,label
2026-10-01,2026-12-31,all,new_followers,300,
2026-10-01,2026-12-31,instagram,engagements,1500,
2026-10-01,2026-12-31,linkedin-personal,followers,800,Matt's LinkedIn to 800 followers
2026-10-01,2026-12-31,all,engagement_rate,5%,
```

- `platform`: `all`, `instagram`, `linkedin`, `linkedin-personal` or `youtube`
- `metric`: `new_followers`, `followers` (a total to reach), `reach`, `views`, `engagements`, `engagement_rate` (write it as `5%`) or `posts`
- `label`: optional; the name shown on the dashboard

Each goal shows progress against its target, with a marker for where you should be by now if you keep a steady pace. **On track** means at or ahead of pace, **Close** means within 20% of it, and **Behind** means further back. Pace is measured up to the newest data uploaded, so upload the week's exports before reading it.

## How the numbers are calculated

- Weeks run Monday to Sunday.
- **Engagements** use the platform's own total when the export has one. Otherwise they are likes/reactions + comments + shares/reposts + saves.
- **Engagement rate** = engagements ÷ reach. It uses impressions/views when there's no reach number.
- **Reach** is the sum of daily reach. People reached on several days count more than once.
- **YouTube** counts video views, not thumbnail impressions. New subscribers count as new followers.
- If a platform has only a posts export, its weekly numbers are totals for the posts published that week. The platform's card says so.
- **Download CSV** gives you the weekly table for reports.

## Settings

`config.js` holds the client name and the list of platforms. Each platform's `id` must match a folder name in `data/`.
