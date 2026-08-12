# Soccer Carpool Coordinator — Complete Requirements Document (v1.0)

---

## Executive Summary

A mobile application to coordinate youth soccer team carpool logistics across recurring practice sessions. The app allows parents to claim pickup and drop-off shifts, swap assignments with mutual consent, view team schedules transparently, and receive push notifications for all changes. Designed for teams up to 100 users, with support for multiple collection points, multi-team households, AI chat assistance, and comprehensive admin controls.

**Target Platform:** React Native (iOS/Android)  
**Key User Roles:** Parent (standard), Admin (team management)  
**Scale:** ~100 users per team instance  
**Session Frequency:** 3x per week (configurable)

---

## 1. Problem Statement

Parents on a youth soccer team need to coordinate who drives kids to practice and who drives them home, across a recurring but changeable schedule, without double-bookings, missed pickups, or endless group-chat confusion.

---

## 2. Core Data Model

| Entity | Key Fields | Description |
|---|---|---|
| **Team** | id, name, season, roster_ids, admin_ids | Represents a single team instance; one app can support multiple independent teams. |
| **Parent/Guardian (User)** | id, name, phone, email, linked_player_ids, team_ids, role, language_preference, notification_prefs, is_active | A single user can belong to multiple teams and have multiple linked children. Supports Hebrew and English. |
| **Player (Child)** | id, name, age, team_id, parent_ids | Used for roster context and collection point assignments. |
| **Practice Session** | id, team_id, date, time, field_location, status, created_at | An individual instance of a scheduled practice; generated from template but editable independently. |
| **Collection Point** | id, team_id, name, address, type (`PICKUP`, `DROPOFF`, `BOTH`), gps_coords | Physical location where players are collected or dropped off. |
| **Session-Point Assignment** | id, session_id, point_id, player_ids, direction (`TO_PRACTICE`, `FROM_PRACTICE`), time_window | Defines which players belong to which collection point for a given session and direction. |
| **Shift** | id, session_id, point_id, direction (`TO_PRACTICE`, `FROM_PRACTICE`), assigned_user_id, status (`open`, `claimed`, `pending_swap`), created_at, version | Atomic unit people sign up for; one per collection point per direction per session. Includes version for optimistic locking. |
| **Swap Request** | id, shift_id, requesting_user_id, current_holder_id, status (`pending`, `accepted`, `declined`, `expired`), created_at, expires_at | Request to trade shifts between two parents. |
| **Schedule Template** | id, team_id, recurrence_rule, default_time, default_field_location, default_collection_points, created_by, updated_at | Defines recurring pattern (Mon/Wed/Fri, etc.); auto-generates sessions N weeks out. |
| **Audit Log Entry** | id, team_id, timestamp, actor_id, action_type, target_entity, before_state, after_state, source (`app`, `ai_chat`), ai_context | Comprehensive log of all meaningful system changes. |

---

## 3. Functional Requirements

### 3.1 Flexible Recurring Schedule

**Requirement 1: Schedule Template Management**
- Admin can define a recurrence pattern (e.g., Monday/Wednesday/Friday at 6:00 PM) that auto-generates upcoming practice sessions for the next N weeks (configurable, default N=8).
- Recurrence rule supports weekly, bi-weekly, or custom intervals.
- Any individual session can be edited (date, time, location, collection points) or cancelled without altering the template.
- Admin can edit the template itself, which regenerates future sessions (but does not retroactively change past sessions already held or in progress).
- Cancelled sessions remain in the system with a `cancelled` status for historical audit purposes but do not generate shifts.

**Acceptance Criteria:**
- Template creation wizard in admin UI
- Session list shows all upcoming sessions with editable individual records
- Bulk-edit capability: "change all future sessions to time X"
- Audit log captures template changes and session modifications

---

### 3.2 Independent Drop-off and Pick-up Shifts

**Requirement 2: Dual-Shift Sessions**
- Each Practice Session has exactly two independent shift groups: drop-off (TO_PRACTICE) and pick-up (FROM_PRACTICE).
- A parent can hold one, both, or neither shift for a given session.
- Shifts are scoped to a Collection Point, so a parent may hold the drop-off at "123 Oak St" and the pick-up at "Downtown Park" (or just one, or neither).
- Shift status is independent: drop-off can be claimed while pick-up remains open, etc.

**Acceptance Criteria:**
- Schedule view clearly shows TO_PRACTICE and FROM_PRACTICE as separate columns/sections
- A parent can claim one shift without being forced to claim the other
- UI prevents double-claiming the same shift for the same person

---

### 3.3 Self-Service Shift Sign-up (No Approval Required)

**Requirement 3: Direct Claim for Open Shifts**
- Any parent can claim any open shift directly via a single tap/click — no admin approval needed to claim an empty slot.
- Parents can voluntarily release a shift they hold, immediately making it available to others.
- Released shifts return to "open" status and are visible to all parents.
- First parent to claim a released shift wins (atomic claim via optimistic locking).

**Acceptance Criteria:**
- "Claim" button on every open shift, one-tap action
- "Release" button on every claimed shift held by the current user
- Immediate in-app feedback: "Claimed" or "Already claimed by X" if race condition occurs
- Broadcast notification to all parents when a shift is claimed or released

---

### 3.4 Swap Mechanism (Mutual Consent)

**Requirement 4: Shift Swaps with Consent Flow**
- If a shift is already assigned to Parent A and Parent B wants it, Parent B sends a **swap request** to Parent A (not a direct override).
- Shift remains with Parent A until they explicitly respond.
- Parent A can:
  - **Accept**: Shift reassigns to Parent B, all parents notified.
  - **Decline**: Shift stays with Parent A, Parent B notified.
  - **Ignore**: Request expires after a configurable timeout (default 24–48h); Parent B is notified, request closed.
- Optional: Parent B can propose a trade ("I'll give you my Friday pickup if you take my Wednesday drop-off") in addition to a plain swap request.
- Swap requests and responses are logged in the audit trail.

**Acceptance Criteria:**
- "Swap Request" button on every claimed shift
- Notification to current holder with "Accept / Decline / Ignore" options
- Swap request card shows who's requesting and what they're offering (if a trade)
- Expiry is enforced server-side; expired requests are auto-closed
- Broadcast notification when swap is accepted/declined
- Audit log captures all swap lifecycle events

---

### 3.5 Broadcast All Changes to All Users

**Requirement 5: Universal Change Notifications**
- Any state change triggers a push notification / in-app alert to **all** team parents:
  - Shift claimed / released / swapped
  - Swap request sent / accepted / declined / expired
  - Session created / edited / cancelled
  - Schedule template changed
  - User added / removed from team
  - Admin promoted / demoted
  - Escalation triggered (see Requirement 11)
- Notification includes: what changed, timestamp, who's now responsible, and a deep link to the relevant shift/session.
- Secondary digest option (opt-in, default off): daily or weekly summary email listing all changes instead of individual push alerts.
- Notification preferences per user: opt-in/opt-out by event type.

**Acceptance Criteria:**
- Push notifications delivered within seconds of state change
- Each notification includes action context (who, what, when)
- Deep link in notification opens the relevant session/shift
- Digest email contains summary of all changes in period
- Audit log records every broadcast notification sent (timestamp, recipient list, content)
- User can customize which event types trigger notifications

---

### 3.6 Full Schedule Visibility (Read Access Universal)

**Requirement 6: Transparent Schedule**
- All parents can view the entire schedule (past, current, and upcoming sessions), who's assigned to each shift, and which shifts are open/unfilled.
- Read access is universal — no restrictions based on personal assignments.
- UI highlights unfilled shifts prominently (color-coded, marked as "URGENT" if within escalation window).
- Schedule view includes:
  - Session date, time, field location
  - Collection points for that session
  - Pickup and drop-off shift status for each collection point (claimed by X, open, etc.)
  - Players assigned to each collection point
  - Current assignment or "claim here" action
- Past sessions show historical records (who drove, when, no further edits allowed).

**Acceptance Criteria:**
- Schedule accessible to all logged-in users (no permission gate)
- Unfilled shifts highlighted with visual indicator (red/orange)
- Player roster visible per collection point per session
- One-tap access to swap/claim actions from schedule view
- Historical sessions remain visible but are read-only

---

### 3.7 Race Condition Handling (Atomic Claims)

**Requirement 7: Optimistic Locking & Transactional Integrity**
- Shift claiming must be atomic: if two parents tap "claim" on the same open shift simultaneously, only one can succeed.
- Implementation: use optimistic locking (version/timestamp check) or a transactional backend operation.
- The loser of the race gets an immediate, friendly in-app message: "That shift was just claimed by X" (not a silent failure or error page).
- Same principle applies to swap-accept: if a shift is claimed/changed between the swap request and the accept, the accept fails gracefully with "This shift is no longer available" or similar.
- All transactions (claim, release, swap-accept) are logged in the audit trail with timestamps and version info.

**Acceptance Criteria:**
- Load-test scenario: 10 parents all tap "claim" on the same open shift within 100ms
- Only 1 succeeds; 9 see "already claimed" message
- No shift double-assignment in database
- Swap-accept fails cleanly if shift state has changed since request creation
- Audit log shows version/timestamp for every claim attempt

---

### 3.8 Clean, Slick, Mobile-First UI/UX

**Requirement 8: User Interface Standards**
- Calendar or list-first view of upcoming sessions (default to current week + next 2 weeks).
- Clear color-coding:
  - Green: "I'm assigned" (my shift)
  - Gray/white: "Covered" (assigned to someone else)
  - Red/orange: "Open" (needs coverage, urgent if within escalation window)
- One-tap actions: claim, release, swap-request visible and easy to access.
- Home screen should read as "what do I need to do this week?" — minimal clutter, focus on actionable items (unclaimed shifts I could help with, my own shifts, pending swaps).
- Typography, spacing, and button sizing optimized for 5–6 inch phone screens.
- Dark mode support (respects system setting).
- Minimal, asset-light design (low bandwidth for international or rural users).

**Acceptance Criteria:**
- Home screen loads in <2 seconds
- All core actions (claim, release, swap) reachable within 2 taps
- Shifts I'm responsible for highlighted at top of view
- Color-blind friendly: not relying on color alone (also use icons, text labels)
- No horizontal scrolling on main views
- Touch targets ≥44pt (iOS) / 48dp (Android)

---

### 3.9 Mobile Device Support (Mandatory)

**Requirement 9: Cross-Platform Mobile**
- App built in React Native for both iOS and Android, tested on:
  - iOS 14+
  - Android 8+ (API level 26+)
- Push notifications via FCM (Android) and APNs (iOS).
- Offline support: basic schedule view and cached shift list available if network drops; changes queued and synced once reconnected.
- Responsive layout: works on phones 4.7" to 6.5" (small to large).
- Battery-conscious: minimal background activity, push notifications only.

**Acceptance Criteria:**
- Builds and runs without errors on latest iOS Simulator and Android Emulator
- Push notifications received within 5 seconds on both platforms
- Schedule and shift list remain readable offline (read-only)
- No memory leaks under sustained use (24h+ running)
- App size <100 MB (iOS) / <120 MB (Android)

---

### 3.10 Hebrew Language & Right-to-Left Support

**Requirement 16: Full RTL & Hebrew Localization**
- The app supports Hebrew as a primary language, with full right-to-left (RTL) text direction and layout mirroring.
- All UI elements automatically adjust for RTL:
  - Text direction (right-aligned paragraphs, right-aligned form labels)
  - Navigation flow (tab order and focus management reversed)
  - Buttons and icons (mirrored where semantically appropriate; e.g., back arrow flips)
  - Lists and cards (maintain logical reading order for Hebrew)
  - Modal dialogs and overlays (RTL-aware positioning)
  - Input fields and text boxes (placeholder text RTL-aligned)
- Language selection: user chooses Hebrew or English during first login; can change anytime in Settings.
- All visible text throughout the app is translated to Hebrew:
  - Button labels ("Claim" → "תבור", "Release" → "שחרר", "Swap Request" → "בקשת החלפה")
  - Navigation and menu items
  - Notifications and alerts (push notifications in selected language)
  - System messages and errors (friendly, clear Hebrew phrasing)
  - Dialog titles, confirmations, and prompts
  - Collection point names and session details (user-entered data respects language context)
  - Team names and player names (user data, preserved as-is)
- Date/time formatting respects Israeli locale:
  - Hebrew date format: DD.MM.YYYY (e.g., 15.01.2025)
  - Time format: 24-hour (standard in Israel; e.g., 18:30, not 6:30 PM)
  - Day names in Hebrew (יום ראשון, יום שני, יום שלישי, יום רביעי, יום חמישי, יום שישי, יום שבת)
  - Month names in Hebrew (ינואר, פברואר, מרץ, אפריל, מאי, יוני, יולי, אוגוסט, ספטמבר, אוקטובר, נובמבר, דצמבר)
  - Relative time in Hebrew ("אתמול" for yesterday, "היום" for today, "מחר" for tomorrow)
- AI Chat Assistant responds in the selected language:
  - Chat understands Hebrew input (questions, natural-language action requests)
  - Responses in Hebrew are natural, contextual, and clear
  - Hebrew language processing (NLP) for intent recognition and action translation
- Audit log and exported reports support language-aware output:
  - Can export audit logs in Hebrew or English (user selectable)
  - Timestamps in audit remain ISO 8601; text labels in chosen language
  - CSV exports include Hebrew text without encoding issues (UTF-8)
- Font support: app uses a font family that clearly renders Hebrew characters:
  - Default system font (San Francisco on iOS, Roboto on Android) supports Hebrew natively
  - Fallback to a Hebrew-optimized font if system font lacks glyphs
  - Font size and line-height optimized for Hebrew script readability
- Right-to-left gesture & interaction behavior:
  - Swipe gestures reversed: swipe right to go back (instead of swipe left)
  - Drag-and-drop and list reordering adapt to RTL
  - Scrolling direction and indicator position aligned to RTL
  - Focus indicators and highlight regions respect RTL layout
- App orientation: supports both portrait and landscape; RTL logic applies to both.

**Acceptance Criteria:**
- Language toggle in Settings; changes take effect immediately (no app restart required)
- All visible UI text translated to Hebrew with native, clear phrasing (not machine-translation, human-reviewed)
- Text in app is right-aligned (not centered or left-aligned) when Hebrew is selected
- All buttons, icons, and input fields mirror/reorient correctly in RTL mode
- No visual layout breaks or misaligned text in Hebrew mode
- Push notifications and audit logs delivered in selected language
- Date/time display uses Hebrew locale formatting (DD.MM.YYYY, 24-hour, Hebrew day/month names)
- AI chat responds in Hebrew when user language is set to Hebrew
- No broken layouts or text cutoff in Hebrew (all strings tested for width, including edge cases like long names)
- Audit log exports include Hebrew text without encoding issues (UTF-8 verified)
- Font rendering is crisp and legible for Hebrew characters across iOS and Android
- Swipe gestures, navigation flow, and focus management correctly reversed for RTL
- App passes automated RTL testing (e.g., React Native RTL linter, Android RTL testing suite, iOS RTL accessibility checks)
- Hebrew locale tests include: single-digit, double-digit, and multi-digit numbers; punctuation; special characters

---

### 3.11 Automatic Reminders

**Requirement 11: Pre-Shift Notifications**
- Automatic reminder push notification sent to assigned parent(s) ahead of their shift.
- Default cadence: night-before (e.g., 8 PM) + morning-of (e.g., 7 AM for 6 PM practice), both configurable by user or admin.
- Reminder includes: session date/time, field location, pickup/drop-off type, collection point(s) and player names.
- User can opt-out of reminders entirely or adjust timing per-team.
- Separate from change-broadcast notifications (Requirement 5); both can fire on the same day.

**Acceptance Criteria:**
- Night-before reminder fires 24h before session start (adjusted for user timezone)
- Morning-of reminder fires ~2h before session start (adjustable)
- Reminder includes all relevant shift details
- Deep link in reminder opens the shift detail view
- User can disable reminders in settings (per-team)
- Audit log records reminders sent

---

### 3.12 No-Show / Last-Minute Escalation

**Requirement 12: Urgent Coverage Request**
- A parent who realizes they can't cover their assigned shift can flag "I can't make it" — distinct from a normal swap request.
- This triggers an immediate, high-visibility broadcast (push + in-app alert) to all team parents: "X can't cover Y at [collection point]. Who can help?"
- **X hours before the session start time** (default X=2, configurable by admin), any unclaimed shifts are auto-escalated with the same urgent broadcast (flagged separately as an admin escalation, not a personal "can't make it").
- First parent to claim the flagged shift wins (same atomic claim logic as Requirement 3).
- Once covered, all parents are notified ("Emergency shift covered by Z").
- If unresolved within the escalation window (e.g., 1h before session), escalate directly to Admins with SMS/urgent alert.

**Acceptance Criteria:**
- "Can't Make It" button on every assigned shift
- Confirmation dialog: "Are you sure? This will alert the whole team."
- Urgent broadcast goes to all users within 30 seconds
- Auto-escalation triggers X hours before (logged in audit trail)
- First clicker gets the shift (atomic)
- Admin receives urgent alert if still unresolved 1h before
- Escalated shifts show visual "EMERGENCY" badge

---

### 3.13 Fairness / Load Visibility

**Requirement 13: Shift Distribution Transparency**
- A simple view (personal and team-wide) showing how many shifts each parent has covered this season, broken out by pickup vs. drop-off.
- Displays: cumulative count, average per season, variance from team average.
- No automatic blocking (e.g., preventing "over-committed" parents from claiming more) — transparency is for self-regulation and admin awareness.
- Admin can see the full fairness report per team; parents see only their own stats.

**Acceptance Criteria:**
- Personal "My Stats" card in home screen: "You've covered 8 pickups, 6 drop-offs this season (team avg: 7 each)"
- Admin report: sortable by parent name, pickups, drop-offs, total shifts
- Exportable CSV for admin review
- Stats update in real-time after each claim/release/accept

---

### 3.14 Onboarding & Invite Flow

**Requirement 14: User Invitation & Registration**
- New parents join a team via an **invite code** or **invite link** generated by an Admin.
- Invite link is one-time use (or expires after N days; configurable).
- Registration flow collects: parent name, phone number, email, linked player/child name(s), notification preferences (push, SMS, email).
- First-login experience:
  - Welcome screen with team name and roster context
  - Prompt to set notification preferences
  - Highlight current week's schedule with any shifts already assigned (if coach pre-assigned)
  - Quick action: "Claim a shift"
- Parent can have a linked player already in the roster, or add a new player during onboarding.

**Acceptance Criteria:**
- Admin can generate invite link in Settings > Manage Users
- Link sent via SMS/email to parent's contact
- Registration form is <60 seconds to complete
- First login shows onboarding; subsequent logins skip it
- Assigned shifts visible on first login
- Parent can edit their profile (name, phone, email, linked players) anytime

---

### 3.15 Multi-Child / Multi-Team Households

**Requirement 15: Household & Cross-Team Support**
- A single parent account can be linked to more than one child (same or different teams).
- A single parent account can belong to more than one team instance (e.g., one kid on Team A, another on Team B).
- A parent's authenticated workspace lists only teams whose invitations they have accepted; arbitrary team IDs cannot be used to discover other team names or metadata.
- Shifts, swaps, schedules, and notifications are scoped per-team (no cross-team confusion).
- UI includes a **team switcher** (dropdown or tab) only when the account belongs to more than one team; selecting a team shows only that team's schedule and shifts. A single-team parent opens their only team directly and sees no team-selection or switching prompt.
- Notifications explicitly state which team (e.g., "U-12 Wildcats: Alex's pickup is open").
- Parent's audit log and shift stats are split by team.

**Acceptance Criteria:**
- User can add/link multiple players during onboarding or in settings
- Team switcher visible and functional only for accounts with multiple accepted team memberships
- Single-team parents see singular team copy and no team-selection or switching controls
- Schedule, shifts, and stats change when team is switched
- Notifications labeled with team name
- Player-to-team mapping in user profile

---

### 3.16 Aggregated Collection Points

**Requirement 17: Multiple Pickup & Drop-off Locations**
- Teams can define multiple pickup and drop-off locations (collection points) instead of a single "home pickup → field" model.
- Each collection point has: name (e.g., "123 Oak St"), address, GPS coordinates (optional), and type (PICKUP, DROPOFF, or BOTH).
- For a given practice session, players are grouped into collection points (e.g., "Players A, B, C go to Oak St pickup; Players D, E go to Downtown Park pickup; all go to School Main Gate for drop-off").
- A driver claiming a shift commits to collecting **all** players assigned to that collection point for that direction.
- Example scenario:
  - Session: Wednesday 6 PM practice at Central Field
  - Collection points: "123 Oak St (pickup)", "Downtown Park (pickup)", "Central Field (drop-off)"
  - Shifts generated: Oak St pickup, Downtown Park pickup, Central Field drop-off (3 shifts, 2 pickup groups, 1 drop-off)
  - Parent claims "Oak St pickup" → they're committing to get all players assigned to Oak St at their designated time
- Different sessions can have different collection-point configurations (e.g., one week pickup at Oak St, next week at Downtown Park) — admins can edit per-session.
- The schedule view highlights which collection points are covered and which still need drivers, broken out by direction (pickup/drop-off).
- Audit log captures all collection point assignments and changes.

**Acceptance Criteria:**
- Admin can create/edit/delete collection points in Team Settings
- Collection point selector during shift creation shows players assigned to each point
- Schedule view breaks down shifts by collection point (not just TO_PRACTICE / FROM_PRACTICE)
- Claiming a shift at "Oak St" shows all players at that point
- Deep link to collection point detail includes address and GPS (optional routing).
- Session editor allows per-session override of collection point assignments
- Audit log shows when collection point assignments change

---

## 4. Access Control & User Management

### 4.1 Login Restricted to Allowed Users

**Requirement: Invite-Only Access**
- The app is closed-roster — no open self-signup. Someone can only log in if an Admin has added them to the team.
- Authentication is passwordless via WebAuthn passkeys, not SMS/email one-time codes — see §9.1 for why and how this replaces the originally-specified OTP flow.
- Login flow:
  1. User enters phone number or email.
  2. System checks if they exist in the team roster **and have a registered passkey**.
  3. If yes: prompt the browser's passkey ceremony (Face ID, Touch ID, Windows Hello, or a security key) for that device.
  4. If no: show "You haven't been added to this team yet — ask your team admin" message (the same message whether the contact is unrecognized or recognized-but-passkey-less, so the latter case isn't a distinguishable oracle).
- Unrecognized users cannot create an account; they must be invited by an Admin first. Accepting an invite immediately prompts passkey registration on that device, completing onboarding in one sitting — there's no separate "log in afterward" step.

**Acceptance Criteria:**
- Login form accepts phone or email
- Unrecognized input rejected with clear message (not a generic error)
- The browser's native passkey prompt appears only for recognized, passkey-registered contacts
- No public roster or user directory (privacy)

---

### 4.2 Admin-Only User Management

**Requirement: Admin Controls**
- Only Admins can add a new parent/user to the team (generates invite link/code).
- Only Admins can remove a user (revokes login access immediately).
- When a user is removed:
  - Their login is disabled.
  - Historical shift records they held remain in the audit log and schedule (read-only) for accountability.
  - Any open swaps involving them are cancelled.
  - Any open shifts they held are returned to "open" status.
- Regular parents cannot add, remove, or edit other users' accounts.
- Only Admins can view the full user roster and manage user roles.

**Acceptance Criteria:**
- Admin-only "Manage Users" section in Settings
- Add user: generates invite link + SMS/email option
- Remove user: confirmation dialog + immediate access revocation
- Removed user still appears in historical audit/shift records
- Removed user cannot log in (auth rejected)
- Audit log captures add/remove events

---

### 4.3 Admin Promotion & Demotion

**Requirement: Hierarchical Admin Roles**
- Any existing Admin can promote another existing (active, non-admin) user to Admin.
- Admins can be demoted back to regular parents (Admin → Parent).
- Safeguard: the system blocks removal/demotion of the **last remaining Admin**, so the team is never left with zero admins.
- Admin status changes are logged in the audit trail with timestamp and who promoted/demoted whom.
- Admin promotion/demotion triggers a broadcast notification to all team parents.

**Acceptance Criteria:**
- Admin can promote/demote users from Manage Users page
- Last admin cannot be demoted (button disabled or error message)
- Promotion/demotion logged in audit trail
- Broadcast notification sent to all parents
- Demoted user retains access to schedule/shifts but loses admin UI

---

### 4.4 Role-Based Permissions Summary

| Feature | Parent | Admin |
|---|---|---|
| Login (if invited) | ✅ | ✅ |
| Claim/release shifts | ✅ | ✅ |
| Request/accept/decline swaps | ✅ | ✅ |
| View full schedule | ✅ | ✅ |
| View personal shift history | ✅ | ✅ |
| View fairness / load stats | ✅ (own only) | ✅ (team-wide) |
| Add new users (invite) | ❌ | ✅ |
| Remove users | ❌ | ✅ |
| Promote/demote admins | ❌ | ✅ |
| Edit schedule template | ❌ | ✅ |
| Edit individual sessions | ❌ | ✅ |
| Manage collection points | ❌ | ✅ |
| View full audit log | ❌ | ✅ |
| Configure notifications (team-wide) | ❌ | ✅ |

---

## 5. Admin Audit Log

### 5.1 Comprehensive Logging

**Requirement: Detailed Activity Trail**
- Admins have access to a detailed, chronological, filterable audit log of all meaningful actions in the system.
- Log entry structure: `timestamp | actor (user) | action_type | target (shift/session/user) | before_state → after_state | source (app/ai_chat) | additional_context`

**Loggable Events:**
- Shift claimed / released / swapped / escalated
- Swap requested / accepted / declined / expired
- Session created / edited / cancelled
- Collection point assigned/reassigned
- Schedule template created / edited / deleted
- User added / removed / promoted / demoted
- Admin role changes
- Escalation triggered / resolved
- Login attempts by non-registered users (for security)
- Broadcast notifications sent (timestamp, recipient list, content)
- AI chat actions (natural-language request, translated action, result)
- Reminder sent (timestamp, recipient, reminder type)

**Filtering & Export:**
- Filterable by: user, date range, action type, target entity, source (app vs. AI).
- Exportable as CSV for external audit or record-keeping.
- Full-text search on actor name or shift/session identifiers.
- Log is read-only (Admins cannot delete or edit log entries).

**Access & Retention:**
- Accessible only to Admins; parents see only their own personal history.
- Retention: indefinite by default, with optional end-of-season export/archival.
- Exported logs remain available in a separate archive section.

**Acceptance Criteria:**
- Audit log page accessible from Admin Settings
- Every functional change captured within 1 second
- Filter by user, date, action type works correctly
- CSV export includes all columns and filters applied
- No access to full log for non-admins (permission check)
- Admins cannot modify/delete log entries

---

## 6. AI Chat Assistant

### 6.1 Conversational Interface

**Requirement: Natural-Language Actions & Queries**
- Every logged-in user can access an AI chat interface (persistent chat bubble or dedicated chat screen).
- The assistant can:
  - **Answer questions**: "What's my schedule this week?", "Who's picking up on Wednesday?", "Which shifts are still open?", "How many pickups have I done this season?"
  - **Perform actions** on the user's behalf, strictly scoped to their permission level:
    - **Parents**: claim an open shift, release their own shift, send/accept/decline a swap request, flag "can't make it", view/filter schedule.
    - **Admins**: additionally add/remove users, promote/demote admins, create/edit sessions or schedule templates, view audit log, manage collection points.
- The assistant must **never exceed the calling user's permissions** — e.g., a parent asking "remove Mike from the team" receives a refusal ("You don't have permission to remove users").

### 6.2 Backend Integration & Consistency

**Requirement: Same Operation Paths**
- Every action taken via AI chat routes through the **same backend operations** as the manual UI (same atomic claim logic, same swap-consent flow, same broadcast notifications).
- Chat is an alternate **input method**, not a bypass or shortcut that skips validation/conflict checks.
- Example: claiming a shift via chat still hits the optimistic-lock logic and fails gracefully if the shift is already claimed by someone else.

### 6.3 Logging & Traceability

**Requirement: Audit Trail for AI Actions**
- Every action initiated via AI chat is logged in the audit log with:
  - `source: ai_chat`
  - Natural-language request / transcript (what the user asked)
  - Translated action (how the system interpreted it)
  - Result (success/failure + outcome)
- Admins can filter the audit log by `source: ai_chat` to see all AI-driven actions.

### 6.4 Confirmation & Safety

**Requirement: Destructive Action Confirmation**
- Destructive or hard-to-reverse actions (removing a user, cancelling a session, releasing multiple shifts) require explicit confirmation from the user in the chat.
- Example: User asks "cancel the Wednesday session". Assistant responds: "Are you sure? This will cancel the session and notify all parents. Yes/No?"
- Confirmation is **not** automatic (user must type "yes" or tap confirm); chat does not interpret ambiguous responses as consent.
- Mirrors the confirmation dialogs in the manual UI (not a lower standard).

### 6.5 Model & Provider

**Requirement: Technical Implementation**
- Powered by Claude API (Anthropic).
- Model: `claude-sonnet-4-6` or later.
- Requests include full context: user ID, team ID, user's permission level, current schedule, shift list.
- Temperature: 0.3 (low randomness for consistent, reliable actions).
- Max tokens: ~500 per response (concise, mobile-friendly answers).
- Fallback: if API is unavailable, chat shows "Assistant temporarily unavailable" and suggests using the manual UI.

**Acceptance Criteria:**
- Chat responds within 3 seconds
- Natural-language questions answered correctly 95%+ of the time
- Actions initiated via chat produce same outcomes as manual UI
- Audit log captures all AI actions with full context
- Confirmation required for destructive actions
- Permission checks enforced; no privilege escalation
- Graceful fallback if API down

---

## 7. Scale Assumptions

**Target Scale: ~100 users per team instance**
- This scale is small enough that a standard relational backend (PostgreSQL, MySQL) with straightforward optimistic-locking on shift claims is sufficient — no need for heavy distributed-systems tooling.
- Push notification fan-out to 100 devices per event is trivial for any standard push provider (FCM for Android, APNs for iOS).
- Database indexing on `(team_id, session_id, shift_id)` and `(user_id, team_id)` is sufficient for fast queries.
- In-memory caching (Redis) recommended for frequently-accessed schedule/shift lists to reduce database load.

---

## 8. Technical Implementation Details

### 8.1 Platform & Architecture

**Frontend:** React Native (iOS + Android)
**Backend:** Node.js / Python (REST API or GraphQL)
**Database:** PostgreSQL (primary relational store)
**Cache:** Redis (optional, for schedule/shift caching)
**Push Notifications:** FCM (Android) + APNs (iOS)
**AI Integration:** Claude API (Anthropic)
**Authentication:** WebAuthn passkeys, identifier-first (phone/email lookup, then a device passkey ceremony) — see §8.2 decision 6 and §9.1
**Version Control:** Git (GitHub, GitLab, or Bitbucket)

### 8.2 Open Questions Resolution

| # | Question | Decided |
|---|---|---|
| 1 | Platform preference? | **React Native** — cross-platform, strong mobile performance, code reuse iOS/Android, push notifications built-in. |
| 2 | Initial Admin setup? | **Team manager or coach designated at team creation.** First user during "create team" flow is prompted for role; if coach/manager, they become initial Admin. |
| 3 | Escalation timing? | **X hours before the scheduled practice start time.** Default X=2 (configurable by admin). Example: practice at 6 PM → escalation at 4 PM. |
| 4 | Non-driving parents? | **Not supported in v1.** All users are drivers; no observer-only role. |
| 5 | Multi-team scope? | **Yes — support multi-team households.** Parent account can belong to multiple teams; team switcher in home screen. |
| 6 | Login method? | **WebAuthn passkeys** (revised from the original Phone OTP decision — see 2026-08-10 note below). No password to forget, no SMS/email vendor dependency to procure or pay for. |
| 7 | Audit log retention? | **Indefinite, with end-of-season archival option.** Admins can export logs by season; system retains raw data long-term. |
| 8 | AI chat provider? | **Claude API (Anthropic)** — permission-scoped, reliable, integrates cleanly with team/shift/user context. |

**2026-08-10 revision note:** Decision 6 originally chose Phone OTP (SMS). It was replaced with WebAuthn passkeys to remove the SMS vendor dependency Stage 0 had left open (no OTP provider had been procured — `ConsoleOtpProvider` just logged codes) and because the closed-roster invite already establishes identity, making a second "prove you own this phone" step redundant. The invite code itself (single-use, admin-issued) is now the proof of identity at registration time; phone/email remain contact fields, not verified login credentials. See §9.1 for the mechanics and §4.1 for the revised login flow.

---

## 9. Security & Privacy

### 9.1 Authentication

- WebAuthn passkeys are the only login method — no password, no SMS/email one-time code, no separate vendor to procure. Login is identifier-first: enter phone or email, and if that contact has a registered passkey, the browser's own passkey ceremony (Face ID, Touch ID, Windows Hello, or a security key) authenticates the device.
- A brand-new parent registers their first passkey immediately after accepting their invite — scoped to that specific invite code (not a bare user ID), bounded to a short window after acceptance, so a captured invite link can't be used to attach a rogue credential to the account indefinitely.
- The very first team admin (who bootstraps via team creation, with no invite involved) registers a passkey the same way, immediately after the team is created, using their already-issued session rather than an invite code.
- Any already-authenticated user can register an additional passkey for a second device through the same authenticated pair of endpoints.
- Session tokens expire after 30 days of inactivity (unchanged from the original OTP-era design).
- Force re-authentication for sensitive actions (admin user removal, schedule template changes).
- Recovery model: a lost/inaccessible device has no self-service password reset (there is no password). An admin re-invites the affected person, exactly as for a brand-new parent; accepting the new invite registers a fresh passkey on their new/current device.

### 9.2 Authorization

- All API endpoints check user role against action (parent vs. admin) before executing.
- Shifts, schedules, and notifications scoped per team — users cannot see or modify other teams' data.
- Audit log access restricted to admins; parents see only their own actions.

### 9.3 Data Privacy

- Personally identifiable information (names, phone numbers, emails, addresses of collection points) stored securely.
- No third-party analytics tracking personal data (Sentry or similar for error reporting only).
- User consent collected for SMS reminders and push notifications.
- GDPR / CCPA compliance: export user data, delete user data (on request, with admin approval).

### 9.4 Rate Limiting & DDoS Protection

- API endpoints rate-limited: 100 requests/minute per user, 1000/minute per IP.
- Shift claim endpoint specially protected: 10 attempts/minute per user (prevents spam claiming).
- Broadcast notifications throttled: max 20 notifications per team per hour (prevents notification spam if multiple rapid changes).

---

## 10. Acceptance Criteria Summary

| Component | Acceptance Criteria |
|---|---|
| **Shift Claiming** | Atomic; no double-assignments. Race condition loser gets friendly message. |
| **Swaps** | Mutual consent required. Expiry enforced. Audit log complete. |
| **Broadcasts** | All parents notified within 30 seconds of change. Deep links work. |
| **Reminders** | Sent 24h before + ~2h before. User-configurable. Deliverable as push. |
| **Escalation** | Triggered X hours before practice. Admin alert if unresolved. Logged. |
| **Schedule Visibility** | All users see all sessions, shifts, collection points, player assignments. |
| **Collection Points** | Multiple points per session. Drivers commit to all players at their point. |
| **Admin Audit Log** | All meaningful actions logged. Filterable, exportable, read-only. |
| **AI Chat** | Answers questions correctly 95%+ of time. Routes through same backend ops. Requires confirmation for destructive actions. |
| **Mobile UI** | All actions <2 taps. Loads home in <2s. Works offline (read-only). Touch targets ≥44pt. |
| **Hebrew & RTL** | Full RTL layout support. All text translated to Hebrew. Date/time in Hebrew locale. Chat responds in Hebrew. No layout breaks. |
| **Multi-Team** | Parent can belong to multiple teams. Team switcher works. Scopes separate. |
| **Onboarding** | <60s registration. First login shows team context + actionable items. |
| **Performance** | Chat responds <3s. API <200ms. No memory leaks over 24h. App <120MB. |

---

## 11. Success Metrics (Post-Launch)

- **Adoption**: 80%+ of team parents on app within first 2 weeks of team setup.
- **Shift Coverage**: 95%+ of shifts claimed by start of practice (no last-minute scrambles).
- **Swap Efficiency**: Average swap request response time <4 hours.
- **Escalation**: Escalations trigger <2 hours before practice in 99%+ of cases; resolved within 30 minutes in 90%+ of cases.
- **User Satisfaction**: NPS ≥50, 4.5+ stars on app stores.
- **Reliability**: 99.9% uptime. Push notifications delivered within 5 seconds.
- **AI Accuracy**: Chat correctly interprets and executes user requests 95%+ of the time.

---

## 12. Roadmap (Future Versions)

**v1.1**
- Notifications preferences (SMS, email, push) in addition to push-only.
- Fairness-based recommendations ("You've done 3 pickups, 1 drop-off; consider a drop-off this week?").
- Team messaging (in-app discussion board for session-specific logistics).

**v1.2**
- Player attendance tracking (who actually showed up / no-show record).
- Integration with team calendar (iCal export, Google Calendar sync).
- Parent feedback & rating ("Great driver! 5 stars.").

**v2.0**
- Multi-league / tournament support (spring/fall season splits, tournament dates).
- Cost-splitting (gas reimbursement tracking, easy payment splits via Venmo/PayPal).
- Sibling-aware scheduling (prefer parents with multiple kids going to same session).
- Admin reporting dashboard (visualizations of fairness, coverage trends, escalation history).

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| **Shift** | Atomic unit of carpool work (one direction, one collection point, one session). |
| **Collection Point** | Physical location where players are picked up or dropped off (e.g., "123 Oak St", "Downtown Park"). |
| **Session** | Individual instance of a scheduled practice (e.g., "Wednesday 6 PM, Sept 12, Central Field"). |
| **Swap Request** | Parent B's request to trade an assigned shift with Parent A; requires Parent A's acceptance. |
| **Escalation** | Urgent broadcast when a shift remains unclaimed X hours before practice, or when a parent flags "can't make it". |
| **Audit Log** | Comprehensive record of all system actions (claims, swaps, admin changes, escalations, etc.). |
| **Collection Point Assignment** | Mapping of players to a collection point for a given session and direction. |
| **Passkey** | A WebAuthn credential bound to a specific device's built-in security (Face ID, Touch ID, Windows Hello, or a security key); used for login authentication instead of a password or SMS code. |

---

## Appendix B: Data Schema (Summary)

```sql
-- Teams
CREATE TABLE teams (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  season VARCHAR(50),
  created_at TIMESTAMP,
  created_by_user_id UUID
);

-- Users (Parents / Admins)
CREATE TABLE users (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  phone VARCHAR(20) UNIQUE,
  email VARCHAR(255) UNIQUE,
  role ENUM('parent', 'admin'),
  language_preference VARCHAR(10) DEFAULT 'en', -- 'en' for English, 'he' for Hebrew
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Team Members (many-to-many)
CREATE TABLE team_members (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id),
  user_id UUID REFERENCES users(id),
  role ENUM('parent', 'admin'),
  joined_at TIMESTAMP
);

-- Players (Children)
CREATE TABLE players (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id),
  name VARCHAR(255),
  age INT,
  created_at TIMESTAMP
);

-- Player-to-Parent mapping
CREATE TABLE player_parents (
  id UUID PRIMARY KEY,
  player_id UUID REFERENCES players(id),
  user_id UUID REFERENCES users(id),
  relationship VARCHAR(50) -- 'parent', 'guardian', etc.
);

-- Practice Sessions
CREATE TABLE practice_sessions (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id),
  date DATE,
  time TIME,
  field_location VARCHAR(255),
  status ENUM('scheduled', 'completed', 'cancelled'),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Collection Points
CREATE TABLE collection_points (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id),
  name VARCHAR(255),
  address VARCHAR(255),
  gps_lat DECIMAL(10, 8),
  gps_lng DECIMAL(11, 8),
  type ENUM('pickup', 'dropoff', 'both'),
  created_at TIMESTAMP
);

-- Session-Point Assignments (which players go to which collection point)
CREATE TABLE session_point_assignments (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES practice_sessions(id),
  point_id UUID REFERENCES collection_points(id),
  direction ENUM('to_practice', 'from_practice'),
  player_ids UUID[] -- array of player IDs assigned to this point
);

-- Shifts
CREATE TABLE shifts (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES practice_sessions(id),
  point_id UUID REFERENCES collection_points(id),
  direction ENUM('to_practice', 'from_practice'),
  assigned_user_id UUID REFERENCES users(id),
  status ENUM('open', 'claimed', 'pending_swap'),
  version INT DEFAULT 0, -- for optimistic locking
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Swap Requests
CREATE TABLE swap_requests (
  id UUID PRIMARY KEY,
  shift_id UUID REFERENCES shifts(id),
  requesting_user_id UUID REFERENCES users(id),
  current_holder_id UUID REFERENCES users(id),
  status ENUM('pending', 'accepted', 'declined', 'expired'),
  created_at TIMESTAMP,
  expires_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Schedule Templates
CREATE TABLE schedule_templates (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id),
  recurrence_rule VARCHAR(255), -- e.g., 'FREQ=WEEKLY;BYDAY=MO,WE,FR'
  default_time TIME,
  default_field_location VARCHAR(255),
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Audit Log
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id),
  timestamp TIMESTAMP,
  actor_id UUID REFERENCES users(id),
  action_type VARCHAR(100), -- e.g., 'shift_claimed', 'user_added', 'swap_accepted'
  target_entity VARCHAR(100), -- e.g., 'shift', 'user', 'session'
  target_id UUID,
  before_state JSONB,
  after_state JSONB,
  source ENUM('app', 'ai_chat'),
  ai_context JSONB, -- if source='ai_chat', includes natural language request & translation
  created_at TIMESTAMP
);

-- Notification Log
CREATE TABLE notification_logs (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id),
  recipients UUID[],
  event_type VARCHAR(100),
  content TEXT,
  sent_at TIMESTAMP
);
```

---

**End of Requirements Document v1.0**

*Last updated: [Date]*  
*Document Owner: Product Team*  
*Status: Approved for Development*
