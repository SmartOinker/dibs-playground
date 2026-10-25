# dibs playground

A shared repository for trying [dibs](https://github.com/2elliot/dibs) (private)
with several coding agents at once. Each tester runs one agent (Claude Code, Codex
or Droid) on their own laptop, in their own clone of this repo. dibs lets the
agents agree on the interfaces between their parts before they write code; this
repo is where the code they write comes together.

## Setup (each tester)

You need Node 22 or newer, a signed-in `gh`, read access to `2elliot/dibs`, and
your coding agent installed and signed in.

1. **Install dibs** from the latest verified experiment release:

   ```sh
   gh release download real-exp-latest --repo 2elliot/dibs --pattern '*.tgz' --clobber
   npm install --global ./dibs-experience-0.1.0.tgz
   ```

2. **Clone this repo and make a branch for your agent:**

   ```sh
   git clone https://github.com/SmartOinker/dibs-playground.git
   cd dibs-playground
   git switch -c agent/<claude|codex|droid>
   ```

3. **Create or join the room.** One person creates it:

   ```sh
   dibs create --provider claude --brief "A small todo app: a JSON API and a web frontend that uses it" --interface api.todos="Routes, request and response JSON for todos"
   ```

   It prints a `dibs1_…` join code (share it privately) and a dashboard link.
   Everyone else joins with their own provider:

   ```sh
   dibs join <join-code> --provider codex
   dibs join <join-code> --provider droid
   ```

4. **Open your agent in the clone** (`claude`, `codex` or `droid`) and accept its
   trust prompts for the dibs MCP server and hooks. Then check the wiring:

   ```sh
   dibs doctor --provider <claude|codex|droid>
   ```

   Both lines should say `running` / `observed`.

## Working together

Give each agent its own part of the app in its own folder, for example:

| Agent  | Folder    | Task                                                            |
| ------ | --------- | --------------------------------------------------------------- |
| Claude | `server/` | The todo JSON API                                               |
| Codex  | `web/`    | A web frontend that lists, adds and completes todos via the API |
| Droid  | `client/` | A Node script that exercises the API end to end                 |

Tell each one to coordinate shared interfaces through dibs before implementing
them, and don't spell out the API shape: the point is to watch dibs find and
resolve their disagreements. Follow along on the dashboard or with
`dibs status --provider <yours>`.

When an agent is done, commit its folder on its `agent/…` branch, push, and open
a pull request into `main`. Because the agents agreed on the interface first, the
parts should fit together after merging. Checking that they do is the test.

## Notes

- **Don't commit dibs' config files.** `dibs create`/`join` writes `.mcp.json`,
  `.claude/settings.local.json`, `.codex/` and `.factory/` with absolute paths for
  your machine. `.gitignore` already excludes them.
- **The experiment server resets whenever `real_exp` is pushed in the dibs repo.**
  If your room stops working, run `dibs leave --local --provider <yours>` and
  create or join a new room.
- **Plans and messages are publicly readable** in the experiment database. Don't
  put anything private in a brief or plan.
- When you're finished: `dibs leave --provider <yours>`; the creator runs
  `dibs close --provider claude` to end the room.
