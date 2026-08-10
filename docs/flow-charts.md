# Admin and User Flow Charts

This guide summarizes the currently shipped web MVP flows as Mermaid diagrams.
It complements [user-guide.md](./user-guide.md): that guide explains the same
behavior in prose, while this page shows the route and decision flow at a
glance.

For this document, **user** means a non-admin team member in the current MVP,
which is typically a **parent**.

## Admin flow

```mermaid
flowchart TD
    A([Start]) --> B{New admin<br/>or returning admin?}

    B -->|New admin| C[Open teams/new]
    C --> D[Enter team, season, name, and phone]
    D --> E[Submit create-team form]
    E --> F[API creates team and signs admin in]
    F --> G{Passkey setup succeeds?}
    G -->|No| H[Stay on passkey retry screen]
    H --> G
    G -->|Yes| I[Land on home]

    B -->|Returning admin| J[Open login]
    J --> K[Enter phone or email]
    K --> L[Complete passkey login]
    L --> M{Login succeeds?}
    M -->|No| N[Show error and retry login]
    N --> J
    M -->|Yes| I

    I --> O{Belongs to multiple teams?}
    O -->|Yes| P[Choose active team]
    O -->|No| Q[Use default team]
    P --> R[Review Home workspace]
    Q --> R

    R --> S{Need to invite a parent?}
    S -->|Yes| T[Use invite form on `/home`]
    T --> U[Copy generated invite link]
    U --> V[Send link through the team's communication channel]
    V --> W[Continue in Home or Schedule]
    S -->|No| W

    W --> X[Open schedule when needed]
    X --> Y[Review sessions and shift status]
    Y --> Z{Claim or release a shift?}
    Z -->|Claim open shift| AA[Shift becomes assigned to admin]
    Z -->|Release own shift| AB[Shift becomes open again]
    Z -->|No| AC[Keep browsing]
    AA --> AD{Conflict returned?}
    AB --> AE{Conflict returned?}
    AD -->|Yes| AF[Show conflict toast and refresh]
    AD -->|No| AC
    AE -->|Yes| AF
    AE -->|No| AC
    AF --> AC

    AC --> AG{Log out?}
    AG -->|Yes| AH[Open log-out confirmation]
    AH --> AI[Session is revoked]
    AI --> AJ([End])
    AG -->|No| W
```

## User flow

```mermaid
flowchart TD
    A([Start]) --> B{First-time join<br/>or returning user?}

    B -->|First-time join| C[Receive invite link from admin]
    C --> D[Open invite link]
    D --> E{Invite exists and is still pending?}
    E -->|No| F[Show invalid or expired state]
    F --> G[Ask admin for a new invite]
    G --> H([End])
    E -->|Yes| I[Review team preview]
    I --> J[Enter name and optional linked players]
    J --> K[Submit join-team form]
    K --> L[API accepts invite and creates or links membership]
    L --> M{Passkey setup succeeds?}
    M -->|No| N[Stay on passkey retry screen]
    N --> M
    M -->|Yes| O[Land on home]

    B -->|Returning user| P[Open login]
    P --> Q[Enter phone or email]
    Q --> R[Complete passkey login]
    R --> S{Login succeeds?}
    S -->|No| T[Show error and retry login]
    T --> P
    S -->|Yes| O

    O --> U{Belongs to multiple teams?}
    U -->|Yes| V[Choose active team]
    U -->|No| W[Use default team]
    V --> X[Review Home workspace]
    W --> X

    X --> Y{Need a shift now?}
    Y -->|Yes| Z[Claim from Home help-needed list or open schedule]
    Y -->|No| AA[Review upcoming assignments and stats]
    Z --> AB[Select Claim on an open shift]
    AB --> AC{Claim succeeds?}
    AC -->|No, someone else claimed first| AD[Show conflict toast and refresh]
    AC -->|Yes| AE[Shift now appears as assigned to you]
    AD --> AF[Keep browsing schedule]
    AE --> AG{Release later?}
    AG -->|Yes| AH[Select Release on your shift]
    AH --> AI{Release succeeds?}
    AI -->|No| AJ[Show release conflict and refresh]
    AI -->|Yes| AK[Shift becomes open again]
    AJ --> AF
    AK --> AF
    AG -->|No| AF
    AA --> AF

    AF --> AL{Log out?}
    AL -->|Yes| AM[Open log-out confirmation]
    AM --> AN[Session is revoked]
    AN --> AO([End])
    AL -->|No| X
```

## Notes

- Role is scoped per team. The same person can be an admin in one team and a
  parent in another.
- A returning user with an already registered passkey uses `/login`; a first
  join from an invite uses `/invite/[code]`.
- Current admin-only web UI is limited to team creation, invite generation from
  `/home`, and any shared shift claim/release actions already available to all
  members. Full admin schedule, roster, and member-management screens are still
  planned rather than shipped.
