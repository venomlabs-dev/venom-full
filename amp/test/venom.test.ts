import assert from 'node:assert/strict'
import { test } from 'node:test'
import venom, { bareTool, contextOf, stopReason } from '../venom.ts'

type Handler = (event: any, ctx: any) => any

function setup(answers: Record<string, string>, { parent = null as string | null } = {}) {
	const handlers: Record<string, Handler> = {}
	const calls: any[] = []
	const amp = {
		on: (name: string, fn: Handler) => {
			handlers[name] = fn
		},
		helpers: {
			shellCommandFromToolCall: (e: any) => (e.tool === 'Bash' ? { command: e.input.cmd } : null),
		},
	}
	venom(amp as any)
	const ctx = {
		thread: { parentThreadID: async () => parent },
		tools: {
			call: async (name: string, input: any) => {
				if (name !== 'venom.get_guidance') throw new Error('unknown tool')
				calls.push(input)
				return { content: [{ type: 'text', text: answers[input.event] ?? '' }] }
			},
		},
	}
	return { handlers, calls, ctx }
}

const hook = (event: string, text: string) =>
	JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })

test('helpers', () => {
	assert.equal(contextOf(hook('X', 'hi')), 'hi')
	assert.equal(contextOf(''), '')
	assert.equal(contextOf('plain'), 'plain')
	assert.equal(stopReason(JSON.stringify({ decision: 'block', reason: 'log it' })), 'log it')
	assert.equal(stopReason(''), '')
	assert.equal(bareTool('venom.append_task_log'), 'append_task_log')
	assert.equal(bareTool('mcp__venom__append_task_log'), 'append_task_log')
})

test('each prompt gets projects and mentions', async () => {
	const { handlers, ctx, calls } = setup({ UserPromptSubmit: hook('UserPromptSubmit', 'Your projects') })
	const first = await handlers['agent.start']({ thread: { id: 'T1' }, message: 'hi' }, ctx)
	assert.equal(first.message.content, 'Your projects')
	assert.deepEqual(calls[0], { event: 'UserPromptSubmit', session_id: 'T1' })
})

test('subagent threads get the subagent note once, and no projects', async () => {
	const { handlers, ctx, calls } = setup(
		{ UserPromptSubmit: hook('UserPromptSubmit', 'Your projects'), SubagentStart: hook('SubagentStart', 'Subagent') },
		{ parent: 'T0' },
	)
	const first = await handlers['agent.start']({ thread: { id: 'T1' }, message: 'hi' }, ctx)
	assert.equal(first.message.content, 'Subagent')
	assert.deepEqual(await handlers['agent.start']({ thread: { id: 'T1' }, message: 'more' }, ctx), {})
	assert.deepEqual(calls, [{ event: 'SubagentStart' }])
})

test('nothing to say adds nothing', async () => {
	const { handlers, ctx } = setup({})
	assert.deepEqual(await handlers['agent.start']({ thread: { id: 'T1' }, message: 'hi' }, ctx), {})
})

test('milestone note is appended to the shell output', async () => {
	const { handlers, ctx, calls } = setup({ PostToolUse: hook('PostToolUse', 'Venom milestone: you committed.') })
	const result = await handlers['tool.result'](
		{ thread: { id: 'T1' }, tool: 'Bash', toolUseID: 'u', input: { cmd: 'git commit -m x' }, status: 'done', output: 'ok' },
		ctx,
	)
	assert.deepEqual(result, { status: 'done', output: 'ok\n\nVenom milestone: you committed.' })
	assert.deepEqual(calls[0], { event: 'PostToolUse', tool: 'Bash', command: 'git commit -m x', session_id: 'T1' })
})

test('a note that fits no output shape goes with the next prompt', async () => {
	const { handlers, ctx } = setup({ PostToolUse: hook('PostToolUse', 'Venom milestone: you pushed.') })
	const result = await handlers['tool.result'](
		{ thread: { id: 'T1' }, tool: 'Bash', toolUseID: 'u', input: { cmd: 'git push' }, status: 'done', output: { exitCode: 0 } },
		ctx,
	)
	assert.equal(result, undefined)
	const next = await handlers['agent.start']({ thread: { id: 'T1' }, message: 'next' }, ctx)
	assert.equal(next.message.content, 'Venom milestone: you pushed.')
})

test('Venom logs are reported so the end-of-turn check sees them', async () => {
	const { handlers, ctx, calls } = setup({})
	const result = await handlers['tool.result'](
		{ thread: { id: 'T1' }, tool: 'venom.append_task_log', toolUseID: 'u', input: {}, status: 'done', output: {} },
		ctx,
	)
	assert.equal(result, undefined)
	assert.deepEqual(calls[0], { event: 'PostToolUse', tool: 'append_task_log', session_id: 'T1' })
	await handlers['tool.result'](
		{ thread: { id: 'T1' }, tool: 'mcp__venom__append_project_log', toolUseID: 'v', input: {}, status: 'done', output: {} },
		ctx,
	)
	assert.deepEqual(calls[1], { event: 'PostToolUse', tool: 'append_project_log', session_id: 'T1' })
	await handlers['tool.result'](
		{ thread: { id: 'T1' }, tool: 'venom.append_task_log', toolUseID: 'w', input: {}, status: 'error', output: {} },
		ctx,
	)
	assert.equal(calls.length, 2)
})

test('end of turn continues once when the server blocks', async () => {
	const { handlers, ctx, calls } = setup({ Stop: JSON.stringify({ decision: 'block', reason: 'Log the merge.' }) })
	const end = (status = 'done') => handlers['agent.end']({ thread: { id: 'T1' }, status, messages: [] }, ctx)
	assert.deepEqual(await end(), { action: 'continue', userMessage: 'Log the merge.', maxContinuations: 1 })
	assert.equal(await end(), undefined)
	assert.equal(calls[1].stop_hook_active, 'true')
	assert.equal(await end('cancelled'), undefined)
})

test('a cancelled continuation does not mark the next turn handled', async () => {
	const { handlers, ctx, calls } = setup({ Stop: JSON.stringify({ decision: 'block', reason: 'Log the merge.' }) })
	const end = (status = 'done') => handlers['agent.end']({ thread: { id: 'T1' }, status, messages: [] }, ctx)
	await end()
	assert.equal(await end('cancelled'), undefined)
	assert.deepEqual(await end(), { action: 'continue', userMessage: 'Log the merge.', maxContinuations: 1 })
	assert.equal(calls[1].stop_hook_active, '')
})

test('Venom not connected: the plugin stays quiet', async () => {
	const { handlers } = setup({})
	const ctx = { thread: { parentThreadID: async () => null }, tools: { call: async () => Promise.reject(new Error('no')) } }
	assert.deepEqual(await handlers['agent.start']({ thread: { id: 'T' }, message: 'x' }, ctx), {})
	assert.equal(await handlers['agent.end']({ thread: { id: 'T' }, status: 'done', messages: [] }, ctx), undefined)
})

test('session.start looks up the parent thread so the first prompt does not wait', async () => {
	let lookups = 0
	const { handlers, ctx, calls } = setup({ SubagentStart: hook('SubagentStart', 'Subagent') }, { parent: 'T0' })
	ctx.thread.parentThreadID = async () => (lookups++, 'T0')
	assert.equal(await handlers['session.start']({ thread: { id: 'T1' } }, ctx), undefined)
	const first = await handlers['agent.start']({ thread: { id: 'T1' }, message: 'hi' }, ctx)
	assert.equal(first.message.content, 'Subagent')
	assert.equal(lookups, 1)
	assert.deepEqual(calls, [{ event: 'SubagentStart' }])
})

test('session.start survives a failed parent lookup', async () => {
	const { handlers, ctx } = setup({})
	ctx.thread.parentThreadID = async () => Promise.reject(new Error('no'))
	assert.equal(await handlers['session.start']({ thread: { id: 'T1' } }, ctx), undefined)
})

test('Ship and Push to Branch prompts ask to log to Venom', async () => {
	const { handlers, ctx } = setup({})
	const ship = await handlers['changes.prompt']({ thread: { id: 'T1' }, workflow: 'ship' }, ctx)
	assert.match(ship.append, /^Venom milestone: you shipped this thread's changes\. If this advances a Venom task, log the outcome/)
	const push = await handlers['changes.prompt']({ thread: { id: 'T1' }, workflow: 'push_branch' }, ctx)
	assert.match(push.append, /you pushed this branch/)
	assert.equal(await handlers['changes.prompt']({ thread: { id: 'T1' }, workflow: 'other' }, ctx), undefined)
	assert.doesNotMatch(ship.append + push.append, /["\\$`\n]/)
})
