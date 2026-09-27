# Presence Engine Requirements (EARS)

1. WHEN a normalized door event arrives for a client, THE ENGINE SHALL find the visit whose observable window [start - 60 min, end + 60 min] contains the event timestamp, or record the event as unmatched.
2. WHEN the first `button_press` or `motion_detected` with `sub_type` human occurs within [start - 30 min, start + grace], THE ENGINE SHALL record it as the arrival candidate and set status arrived_on_time if at or before start + grace.
3. IF two candidate clusters exist more than 20 minutes apart before start + grace, THEN THE ENGINE SHALL ask the Judge to choose the caregiver arrival and SHALL mark the visit ambiguous when confidence is below 0.7.
4. WHEN no arrival is observed by start + grace, THE ENGINE SHALL raise a late_no_arrival exception; WHEN none is observed by start + escalation, THE ENGINE SHALL set no_show and raise a no_show exception.
5. WHEN an arrival is observed after start + grace, THE ENGINE SHALL set arrived_late and auto-resolve the late_no_arrival exception with an arrival note.
6. WHEN the last human event after arrival is followed by a quiet period of departureQuietMin, THE ENGINE SHALL record departure and set completed, or early_departure if before end - earlyDepartureMin.
7. IF human events continue past end + 60 min, THEN THE ENGINE SHALL set departure_not_observed.
8. WHILE the device is offline, motion recording is off, no motion zone exists, the integration is paused or removed, or the device is encrypted for any part of the window, THE ENGINE SHALL overlay unobservable with the specific reasons and SHALL NOT raise no_show.
9. WHEN an EVV record exists for the visit, THE ENGINE SHALL compute the reconciliation outcome (corroborated, contradicted, missing_clock_in_with_door_presence, missing_both, unobservable) with arrival and departure deltas in minutes.
10. WHEN any observation, report, or resolution is written, THE ENGINE SHALL append a signed ledger record chained to the previous record for that client.
11. THE ENGINE SHALL be pure: all time comes from an injected clock, and all judgments come from an injected Judge interface.
12. THE ENGINE SHALL produce identical outcomes for identical inputs (deterministic replay for scenario fixtures).
