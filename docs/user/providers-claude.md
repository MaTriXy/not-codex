# Claude

Not Codex supports the Claude Code provider, including multiple configured Claude instances.

## Reduce Context Usage

In Settings, open a Claude provider and set **Auto-compact after** to a token count between
`100000` and `1000000`. For example, `300000` compacts the conversation into a summary once it
reaches about 300,000 tokens, without changing the model's context window. Leave the field empty
to keep Claude Code's default behavior.

When you return to an older Claude thread with a large context, Not Codex offers to compact the
conversation before you continue. You can also select **Compact context** from the context meter,
or enter `/compact` in the message composer. Claude can additionally show its native compaction
prompt when you resume an old session.

Choosing **Don't ask again** on Claude's native prompt also dismisses the Not Codex reminder for
that Claude provider on the current environment.
