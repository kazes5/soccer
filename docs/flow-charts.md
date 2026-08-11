# Admin and User Flow Charts

This guide summarizes the currently shipped web MVP flows as separate Mermaid
diagrams. Each chart covers one focused journey so it can be read, reviewed,
and updated independently.

It complements [user-guide.md](./user-guide.md): that guide explains the same
behavior in prose, while this page shows the route and decision flow at a
glance.

For this document, **user** means a non-admin team member in the current MVP,
which is typically a **parent**.

## Admin creates a team

```mermaid
flowchart TD
    A([Start]) --> B[Open `/teams/new`]
    B --> C[Enter team, season, name, and phone or email]
    C --> D[Submit create-team form]
    D --> E[API creates team and signs admin in]
    E --> F{Passkey setup succeeds?}
    F -->|No| G[Stay on passkey retry screen]
    G --> F
    F -->|Yes| H[Land on Home]
    H --> I([Continue to team and Home flow])
```

## User accepts an invite

```mermaid
flowchart TD
    A([Start]) --> B[Receive invite link from an admin]
    B --> C[Open `/invite/[code]`]
    C --> D{Invite exists and is still pending?}
    D -->|No| E[Show invalid or expired state]
    E --> F[Ask admin for a new invite]
    F --> G([End])
    D -->|Yes| H[Review team preview]
    H --> I[Enter name and optional linked players]
    I --> J[Submit join-team form]
    J --> K[API accepts invite and creates or links membership]
    K --> L{Passkey setup succeeds?}
    L -->|No| M[Stay on passkey retry screen]
    M --> L
    L -->|Yes| N[Land on Home]
    N --> O([Continue to team and Home flow])
```

## User signs in with a passkey

```mermaid
flowchart TD
    A([Start]) --> B[Open `/login`]
    B --> C[Enter phone or email]
    C --> D[Start passkey login]
    D --> E{Login succeeds?}
    E -->|No| F[Show error and retry login]
    F --> B
    E -->|Yes| G[Receive authenticated session]
    G --> H[Land on Home]
    H --> I([Continue to team and Home flow])
```

## User selects a team and reviews Home

```mermaid
flowchart TD
    A([Authenticated user]) --> B{Belongs to multiple teams?}
    B -->|Yes| C[Choose active team with the team switcher]
    B -->|No| D[Use the default team]
    C --> E[Load Home workspace for active team]
    D --> E
    E --> F[Review next action, assignments, help-needed shifts, and stats]
    F --> G{Open another destination?}
    G -->|Schedule| H[Open `/schedule`]
    G -->|Admin screen| I[Open the selected admin destination]
    G -->|Stay on Home| F
    H --> J([Continue to schedule flow])
    I --> K([Continue to admin management flow])
```

## Admin manages schedule data

```mermaid
flowchart TD
    A([Admin on Home]) --> B{What needs changing?}
    B -->|Collection point| C[Open `/admin/collection-points`]
    C --> D[Create, edit, or delete a collection point]
    D --> E{Validation or scheduled-shift conflict?}
    E -->|Yes| F[Show error and keep current data]
    F --> C
    E -->|No| G[Save change and update the list]
    B -->|Schedule template| H[Open `/admin/schedule-templates`]
    H --> I[Create or edit recurrence, time, location, and points]
    I --> J[Generate or preserve future sessions as allowed]
    J --> K[Show saved template and session count]
    B -->|Individual session| L[Open `/schedule`]
    L --> M[Edit time or location, manage players, or cancel]
    M --> N{Session is historical?}
    N -->|Yes| O[Keep controls read-only]
    N -->|No| P[Save change or confirm cancellation]
    G --> Q([Return to admin navigation])
    K --> Q
    O --> Q
    P --> Q
```

## User claims or releases a shift

```mermaid
flowchart TD
    A([User on Home or Schedule]) --> B{Need a shift now?}
    B -->|No| C[Review upcoming assignments and stats]
    C --> D([Continue browsing])
    B -->|Yes| E[Select an open shift]
    E --> F[Submit Claim]
    F --> G{Claim succeeds?}
    G -->|No, another user won the race| H[Show conflict toast and refresh canonical state]
    H --> D
    G -->|Yes| I[Shift becomes assigned to the user]
    I --> J{Release later?}
    J -->|No| D
    J -->|Yes| K[Select Release on the assigned shift]
    K --> L{Release succeeds?}
    L -->|No| M[Show release conflict and refresh canonical state]
    M --> D
    L -->|Yes| N[Shift becomes open again]
    N --> D
```

## User logs out

```mermaid
flowchart TD
    A([Authenticated user]) --> B[Choose Log out]
    B --> C[Open confirmation dialog]
    C --> D{Confirm logout?}
    D -->|No| E[Close dialog and remain on current page]
    E --> F([Continue current flow])
    D -->|Yes| G[API revokes the session and clears cookies]
    G --> H[Redirect to `/login`]
    H --> I([End])
```

## Notes

- The team and Home flow is shared by admins and parents; available admin
  destinations are determined by the active membership role.
- A returning user with an already registered passkey uses `/login`; a first
  join from an invite uses `/invite/[code]`.
- A user can claim or release each direction independently. The API remains
  authoritative when concurrent actions produce a conflict.
- Current admin UI covers collection points, schedule templates, individual
  session management, team invites, and shared shift actions. Future admin
  operations remain tracked in [PLAN.md](../PLAN.md).
