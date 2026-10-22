Screenshots for the README.

Published:
  monitors.png          the monitors list, one endpoint down and sorted to the top
  monitor-detail.png    one monitor over 24h, with an outage and the recovery
  add-monitor.png       the add-monitor form

Not published, kept for later:
  monitor-detail-live.png    the original capture from a running instance. Real
                             traffic, but only 3 samples over about 2 minutes.
  settings-alerts.png        Settings, webhook destinations. Empty state.
  settings-sharing-team.png  Settings, shared views and invites. Empty state.

monitors.png and monitor-detail.png were rendered from the real dashboard
components with demo props, since a live instance had no failing endpoint to
photograph. The hostnames are the example.com family so they cannot be mistaken
for real traffic.

A degraded row is deliberately absent from monitors.png: see the two entries in
known-issues.md about how a degraded monitor currently renders.
