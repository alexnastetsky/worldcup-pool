# Inviting Players to the World Cup Pool

The app uses Databricks login for identity — there are no in-app accounts or passwords.
Anyone who can open the app is automatically a participant the first time they save
predictions, identified by their login email.

## Per-participant steps

1. **Invite them to the workspace** (workspace admin, one of):
   - UI: workspace **Settings → Identity and access → Users → Add user**, enter their email.
   - CLI: `databricks users create --user-name friend@example.com --profile DEFAULT`
2. **They accept the invite** — they'll get an email from Databricks and set up their login.
3. **Send them the app URL**: https://worldcup-pool-2371699704326236.aws.databricksapps.com

That's it for access: the app has `CAN_USE` granted to the workspace `users` group, and
every invited user lands in that group automatically.

## Running the pool (admin = seashelf@gmail.com)

1. Everyone makes picks on **My Picks** (editable while submissions are open).
2. Optionally dry-run the whole flow, then use **Admin → Danger Zone → Reset pool** to wipe
   test data before the real pool starts.
3. When all predictions are in (before kickoff!), hit **Admin → Lock submissions**.
   Everyone can then see all picks and the standings.
4. As the tournament progresses, enter group-match results and bump each team's
   "furthest stage reached" on the **Admin** page — standings update live.

## Scoring

- Group stage: correct home/away win = 1 pt, correct draw = 2 pts.
- Bracket (cumulative per stage a team reaches, up to your prediction):
  Round of 32 = 1, Round of 16 = 2, Quarterfinals = 3, Semifinals = 5, Final = 8,
  Champion = 12. Example: you predicted Champion, the team loses in the quarterfinals →
  1 + 2 + 3 = 6 pts.
