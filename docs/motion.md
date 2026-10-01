# Motion

Where Campaign Mailer moves, and where it deliberately does not.

This is a working tool people open to check on a campaign and to act on it. Daily use argues for less motion, not more, so the audit below was a filter first: every candidate had to survive four questions — how often a user sees it, what the motion is for, whether it fits the duration budget, and whether it helps on a screen people read. Most did not.

Audited on 14 September 2026, for roadmap tickets #76 and #77.

---

## The vocabulary

One easing curve, defined once in `frontend/src/index.css` as the `ease-out` token: `cubic-bezier(0.23, 1, 0.32, 1)`. It starts fast and settles, which is how something that answers a person should feel. Nothing here uses a bounce: there is no celebration in sending a job application.

Only `transform` and `opacity` move. Under `prefers-reduced-motion: reduce`, movement is dropped and only the fade remains, so the change is still visible.

---

## What moves

| #   | Location                                                                                                                                                                                         | Before                                                     | Purpose                     | Frequency                                              | Motion                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `SendControls.tsx`, `LaunchDialog.tsx`, `CampaignEditor.tsx`, `CampaignNew.tsx`, `Dashboard.tsx` — the primary buttons, and `GoogleSignInButton.tsx` / `MailfindSignInButton.tsx` on `Login.tsx` | No response to a press                                     | Feedback                    | Tens a day at most                                     | `:active` → `scale(0.975)`, 150 ms `ease-out`, through the `press` utility. Not on disabled buttons                                                                                                    |
| 2   | `LaunchDialog.tsx`                                                                                                                                                                               | The confirmation appears and vanishes instantly            | Preventing a jarring change | Rare: once per launch                                  | Dialog `opacity 0 → 1`, `scale(0.97) → 1`; backdrop fades in. 200 ms `ease-out`, entry through `@starting-style`, exit through `allow-discrete`. Stays centred: a modal does not grow from its trigger |
| 3   | `SendControls.tsx` progress bar, `Dashboard.tsx` ceiling meter, `AttachmentPanel.tsx` upload bar                                                                                                 | Animated `width`, which re-lays out the bar on every frame | State indication            | Occasional: a sending campaign moves every few seconds | `transform: scaleX(share)` from the left, 300 ms `ease-out`. Same look, no layout work                                                                                                                 |
| 4   | `SendControls.tsx` — the "plafond atteint" notice                                                                                                                                                | Appears instantly inside a panel the user is watching      | Preventing a jarring change | Rare                                                   | `opacity 0 → 1`, `translateY(4px) → 0`, 200 ms `ease-out`, through `@starting-style`                                                                                                                   |

---

## What does not move, and why

- **Counters counting up to their new value** (`CampaignStatsPanel.tsx`, `SendControls.tsx`). The roadmap listed "mise à jour des compteurs". Rejected on function: these are numbers the user reads to decide whether to pause, and a number in motion is a number that cannot be read. The new value simply replaces the old one.
- **The chart's columns growing to their new height** (`SendsChart.tsx`). It shipped with a 300 ms height transition in #72, and it is removed. Rejected on function — it is data being read — and on budget: it animated `height`.
- **The chart tooltip.** Rejected on frequency: it follows the pointer across thirty columns, many times a minute. It appears at once.
- **Rows of the contact table** entering on a page change or a filter. Rejected on frequency and function: a dense table the user scans and filters, where motion would only delay the answer.
- **The launch blocker message** under the launch button. Rejected on frequency: it toggles on every keystroke while the message is unsaved, and a fade there would flicker.
- **Toasts.** Already animated by sonner, entering and leaving by the same edge. Nothing to add.

---

## Verdict

The interface needed very little: four touches, all under 300 ms, one of them a removal. The highest leverage is the progress bars (row 3). They are the one thing that moves while a campaign sends, and they now move without layout work. Anything new that wants to move should be put through the same four questions first, and added to one of the two lists above.
