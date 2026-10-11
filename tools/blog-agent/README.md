# Blog agent tools

Used by the `ankora-blog-post` Claude skill. Ariel or Hadas gives Claude raw content; Claude writes a Hebrew and an English post, a cover, and a LinkedIn post, and saves both posts to the blog as drafts with the runner's own token. The team publishes from the admin.

| File | What | Where it runs |
|---|---|---|
| `style-guide.md` | Structure, SEO/AIO/GEO, tone, banned words, discretion. Approved 11.10.2026 | read by Claude |
| `linkedin-guide.md` | Personal-profile LinkedIn post. Approved 11.10.2026 | read by Claude |
| `check-post.mjs` | Enforces the style guide. Errors stop the save | cloud workspace |
| `cover-template.html`, `render-cover.mjs` | Covers: template A on the site, C on LinkedIn | cloud workspace (needs Chromium) |
| `publish.mjs` | Uploads covers, creates both drafts, pairs them | the runner's computer (needs only Node 18+) |

## The bundle

One folder per post, `<connected folder>/.blog-agent/<he-slug>/`:

```
post.json        the post, below
cover-he.png     site cover, Hebrew (template A)
cover-en.png     site cover, English (template A)
linkedin-he.png  LinkedIn image (template C)
linkedin.txt     LinkedIn text, ready to paste
publish.mjs      copied in, so the computer needs no checkout
state.json       written by publish.mjs: what is already done
```

`post.json`:

```json
{
  "author": "ariel",
  "allowComparisonTerms": false,
  "linkedinEnglish": false,
  "he": { "title": "", "slug": "", "excerpt": "", "category": "", "tags": [], "content": "", "faq": [{ "q": "", "a": "" }] },
  "en": { "title": "", "slug": "", "excerpt": "", "category": "", "tags": [], "content": "", "faq": [] },
  "linkedin": { "he": "", "en": "" }
}
```

`author` is informational only. The server sets the author from the token.

## Tokens

One per person, minted with `node scripts/blog-agent-token.mjs <ariel|hadas> draft ~/Sites/.blog_agent_token`. Only the printed `person:scope:hash` line goes to `BLOG_AGENT_TOKENS` in Vercel (Production). See `lib/blog-agent-auth.ts`.

**Direct publishing**: after five posts in a row go out without a substantive fix, change that person's scope from `draft` to `publish` in Vercel and run `publish.mjs --publish`. Nothing else changes.

## Things to know

- The server reads posts from the deployed build. A post written through the API exists for the API and the admin only after the deploy its commit triggers, about 1 to 2 minutes. `publish.mjs` keeps its own `state.json` for that reason.
- Each saved post and each cover is one commit, so one post pair is four commits and four deploys.
