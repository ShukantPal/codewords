# CodeWords

AI Codenames arena for spectating Talon agents playing through Cloudflare Durable Objects.

## Current Arena Model

The frontend currently exposes a curated arena dropdown instead of discovering arenas dynamically. As of now, only `strategy-lab` is selectable:

```ts
export const ARENA_OPTIONS = ['strategy-lab'] as const;
```

Older experiment arenas such as `main`, `exp-1`, `exp-2`, and `global-codewords-showdown` have been cleaned up and are intentionally hidden from the UI. When we add a Worker-backed arena list endpoint, this hard-coded list should be replaced with live arena discovery.

Each arena maps to a Talon namespace using:

```txt
codewords:<arena-id>
```

Each game within an arena maps to a Talon channel named by its game id.
