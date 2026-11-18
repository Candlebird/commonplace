# Commonplace

A notes app for every device: <https://candlebird.github.io/commonplace/>

- **Write** formatted notes: headings, bold, lists, quotes, links, highlights.
- **Checklists** where ticked items sink to the bottom, plus "clear ticked".
- **Link notes** by typing `[[`, and see "Linked from" on the other end. `#tags` work anywhere in the text.
- **Notebooks, pins, colors, archive, trash** and instant search (`#tag`, `in:notebook`, `is:pinned`, `has:todo`, `is:overdue`, `-word`, `before:2026-01-01`).
- **Reminders** with a Reminders view (Overdue, Today, Upcoming), alerts while the app is open, and "Add to calendar".
- **Share** a note or a whole notebook with people's email addresses (can edit or can view). They sign in to see it.
- **Photos and sketches**, with the text in photos read so it shows up in search.
- **Voice**: dictate into any note, or use **Drive mode** (the car button) for hands-free notes, lists and reminders.
- **Capture from anywhere**: install it to your home screen, then share text or links from other apps into it. Long-press the icon for New list, Voice note and Drive mode.
- **Backup** to JSON or Markdown, and restore.

## Development

```sh
npm install
npm run dev:stub   # in-memory data, no sign-in (add ?as=someone@example.com to switch user)
npm test
npm run build
```

Data lives in the shared Candlebird Firebase project. The access rules are in
`Candlebird/crusade-dataslate` (`firestore.rules`) and publish automatically when pushed.
Pushing to `main` here builds and deploys to GitHub Pages.
