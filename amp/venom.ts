// Venom for Amp: the hooks Venom Full gives Claude Code and Codex.
//
// Each event calls the Venom server's get_guidance tool through the `venom`
// MCP server you added to Amp, so the wording comes from the server, the
// same as in Claude Code and Codex. If Venom isn't connected, or there is
// nothing to say, the plugin adds nothing.
//
// - Each prompt: your Venom projects and unread mentions on the first prompt
//   of a thread, then new mentions only.
// - Subagent threads: read Venom, report to the parent instead of writing.
// - After a shell command that commits, pushes, opens or merges a PR,
//   releases, deploys or publishes: a reminder to log the outcome.
// - End of turn: if a milestone came after the last Venom log, ask once more
//   (one follow-up turn, no more).
//
// Install: amp plugins add https://raw.githubusercontent.com/venomlabs-dev/venom-full/main/amp/venom.ts
// (or save this file in ~/.config/amp/plugins/).
import type { PluginAPI, PluginTools, ToolResult } from '@ampcode/plugin'

// Amp names remote MCP tools `module.function`; local ones also take mcp__server__tool.
const GUIDANCE_TOOLS = ['venom.get_guidance', 'mcp__venom__get_guidance']

type Input = Record<string, string>

async function guidance(tools: PluginTools, input: Input): Promise<string> {
	for (const name of GUIDANCE_TOOLS) {
		try {
			return textOf(await tools.call(name, input))
		} catch {
			// Not this name, Venom isn't connected, or the call failed: try the next one.
		}
	}
	return ''
}

function textOf(result: unknown): string {
	const content = (result as { content?: unknown })?.content
	if (!Array.isArray(content)) return ''
	return content
		.map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
		.join('')
		.trim()
}

/** additionalContext from a hook-shaped answer, or plain text as is. */
export function contextOf(text: string): string {
	if (!text) return ''
	try {
		const parsed = JSON.parse(text)
		return parsed?.hookSpecificOutput?.additionalContext ?? ''
	} catch {
		return text
	}
}

/** The block reason from a Stop answer, or '' to let the turn end. */
export function stopReason(text: string): string {
	if (!text) return ''
	try {
		const parsed = JSON.parse(text)
		return parsed?.decision === 'block' && typeof parsed.reason === 'string' ? parsed.reason : ''
	} catch {
		return ''
	}
}

/** The bare Venom tool name from an Amp tool name like venom.append_task_log. */
export function bareTool(name: string): string {
	return name.split('__').pop()!.split('.').pop()!
}

function appendTo(output: unknown, note: string): unknown | undefined {
	if (typeof output === 'string') return `${output}\n\n${note}`
	if (output && typeof output === 'object' && typeof (output as { output?: unknown }).output === 'string') {
		const value = output as { output: string }
		return { ...value, output: `${value.output}\n\n${note}` }
	}
	return undefined
}

const LOG_TOOLS = new Set(['append_task_log', 'append_project_log', 'edit_log_entry'])

export default function venom(amp: PluginAPI) {
	const subagent = new Map<string, boolean>()
	const subagentTold = new Set<string>()
	const continued = new Set<string>()
	// Milestone notes that couldn't ride on a tool result go with the next prompt.
	const pending = new Map<string, string>()

	// session.start can't add model context (it returns nothing), so the first
	// prompt's agent.start carries the session-start guidance. Here we only look
	// up whether this thread is a subagent's, so that prompt doesn't wait for it.
	amp.on('session.start', async (event, ctx) => {
		const thread = event.thread?.id
		if (!thread) return
		if (!subagent.has(thread)) {
			subagent.set(thread, Boolean(await ctx.thread.parentThreadID().catch(() => null)))
		}
	})

	amp.on('agent.start', async (event, ctx) => {
		const thread = event.thread.id
		const parts: string[] = []
		const note = pending.get(thread)
		if (note) {
			pending.delete(thread)
			parts.push(note)
		}
		if (!subagent.has(thread)) {
			subagent.set(thread, Boolean(await ctx.thread.parentThreadID().catch(() => null)))
		}
		if (subagent.get(thread)) {
			// Like Claude Code: subagents get the subagent note once, not projects and mentions.
			if (!subagentTold.has(thread)) {
				subagentTold.add(thread)
				parts.push(contextOf(await guidance(ctx.tools, { event: 'SubagentStart' })))
			}
		} else {
			parts.push(contextOf(await guidance(ctx.tools, { event: 'UserPromptSubmit', session_id: thread })))
		}
		const content = parts.filter(Boolean).join('\n\n')
		return content ? { message: { content } } : {}
	})

	amp.on('tool.result', async (event, ctx) => {
		if (event.status !== 'done') return
		const thread = event.thread.id
		const tool = bareTool(event.tool)
		if (LOG_TOOLS.has(tool)) {
			// Lets the end-of-turn check see that the milestone was logged.
			await guidance(ctx.tools, { event: 'PostToolUse', tool, session_id: thread })
			return
		}
		const shell = amp.helpers.shellCommandFromToolCall(event as ToolResult)
		if (!shell?.command) return
		const note = contextOf(
			await guidance(ctx.tools, {
				event: 'PostToolUse',
				tool: 'Bash',
				command: shell.command,
				session_id: thread,
			}),
		)
		if (!note) return
		const output = appendTo(event.output, note)
		if (output === undefined) {
			pending.set(thread, note)
			return
		}
		return { status: 'done', output }
	})

	amp.on('agent.end', async (event, ctx) => {
		const thread = event.thread.id
		const active = continued.delete(thread)
		if (event.status !== 'done') return
		const reason = stopReason(
			await guidance(ctx.tools, {
				event: 'Stop',
				session_id: thread,
				stop_hook_active: active ? 'true' : '',
			}),
		)
		if (!reason || active) return
		continued.add(thread)
		return { action: 'continue', userMessage: reason, maxContinuations: 1 }
	})
}
