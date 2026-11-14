# TomTom fixtures

`ok.json` is HAND-WRITTEN in the shape TomTom documents for Calculate Route.
It is UNCONFIRMED against a live response (no API key was available).
Replace it with a real response (API key removed) once a key exists, and check
that `travelTimeInSeconds`, `noTrafficTravelTimeInSeconds` and `lengthInMeters`
are still the field names.

`malformed.json` is a deliberately unusable body (no routes).
