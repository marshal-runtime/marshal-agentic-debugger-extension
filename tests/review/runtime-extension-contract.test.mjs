import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { builtinModules, createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const manifest = JSON.parse(
  readFileSync(path.join(repositoryRoot, 'runtime-extension.json'), 'utf8'),
);
const MARSHAL_UI_MAX_BYTES = 64 * 1024;
const MARSHAL_UI_MAX_DEPTH = 12;
const NODE_BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const EXECUTION_CONTROL_ACTIONS = [
  ['debug.execution.continue', 'continue'],
  ['debug.execution.stepOver', 'next'],
  ['debug.execution.stepInto', 'stepIn'],
  ['debug.execution.stepOut', 'stepOut'],
  ['debug.execution.pause', 'pause'],
];
const marshalCoreEntrypoint = path.resolve(
  repositoryRoot,
  '..',
  'marshal',
  'node_modules',
  '@marshal',
  'agent-runtime-core',
  'dist',
  'index.js',
);

function maximumJsonDepth(value, depth = 0) {
  if (value === null || typeof value !== 'object') return depth;
  return Object.values(value).reduce(
    (maximum, child) => Math.max(maximum, maximumJsonDepth(child, depth + 1)),
    depth,
  );
}

function debuggerSnapshot() {
  return {
    state: 'paused',
    statusMessage: 'Paused on breakpoint',
    sources: [
      {
        path: 'Q:\\fixture\\app.ts',
        name: 'app.ts',
        language: 'typescript',
        content: 'const answer = 42;',
      },
    ],
    activeSourcePath: 'Q:\\fixture\\app.ts',
    currentLocation: { file: 'Q:\\fixture\\app.ts', line: 2, column: 1 },
    currentThreadId: 7,
    selectedFrameId: 11,
    breakpoints: [
      {
        id: 'bp-1',
        file: 'Q:\\fixture\\app.ts',
        line: 2,
        enabled: true,
        verified: true,
        condition: 'answer === 42',
        origin: 'agent',
      },
    ],
    callStack: [
      {
        id: 11,
        name: 'main',
        source: 'Q:\\fixture\\app.ts',
        line: 2,
        column: 1,
      },
    ],
    locals: [
      {
        name: 'answer',
        value: '42',
        type: 'number',
        variablesReference: 0,
        redacted: false,
      },
    ],
    watches: [
      {
        id: 'watch-1',
        expression: 'answer',
        value: '42',
        type: 'number',
        origin: 'agent',
      },
    ],
    console: [
      {
        id: 'console-1',
        expression: 'answer',
        result: '42',
        type: 'number',
        origin: 'agent',
        timestamp: '2026-08-16T16:00:00.000Z',
      },
    ],
    events: [
      {
        id: 'event-1',
        category: 'stdout',
        message: 'ready',
        timestamp: '2026-08-16T16:00:00.000Z',
      },
    ],
  };
}

class StrictContractHost {
  sessions = new Map();
  listeners = new Map();
  sequence = 0;

  createSession() {
    const sessionId = `debug-${++this.sequence}`;
    this.sessions.set(sessionId, debuggerSnapshot());
    return sessionId;
  }

  requireSession(sessionId) {
    const snapshot = this.sessions.get(sessionId);
    assert.ok(snapshot, `Missing strict-host session: ${sessionId}`);
    return snapshot;
  }

  async invoke(invocation) {
    if (
      invocation.capability === 'debug.session.launch' ||
      invocation.capability === 'debug.session.attach'
    ) {
      const sessionId = this.createSession();
      return { sessionId, snapshot: this.requireSession(sessionId) };
    }
    if (invocation.capability === 'debug.adapter.list') {
      return {
        adapters: [
          { type: 'js-debug', languages: ['javascript', 'typescript'] },
          { type: 'clr-debug', languages: ['csharp'], attachOnly: true },
          { type: 'vsdbg', languages: ['csharp'], optIn: true },
        ],
      };
    }

    const sessionId = String(invocation.input.sessionId);
    const snapshot = this.requireSession(sessionId);
    switch (invocation.capability) {
      case 'debug.session.get':
        return { sessionId, snapshot };
      case 'debug.session.restart':
        return { sessionId, restarted: true, snapshot };
      case 'debug.session.disconnect':
        return { sessionId, disconnected: true, snapshot: { ...snapshot, state: 'completed' } };
      case 'debug.session.terminate':
        return { sessionId, terminated: true, snapshot: { ...snapshot, state: 'completed' } };
      case 'debug.breakpoint.set':
      case 'debug.breakpoint.enable':
      case 'debug.breakpoint.disable':
        return { sessionId, breakpoint: snapshot.breakpoints[0], snapshot };
      case 'debug.breakpoint.remove':
        return { sessionId, removed: 'bp-1', snapshot };
      case 'debug.breakpoint.list':
        return { sessionId, breakpoints: snapshot.breakpoints };
      case 'debug.breakpoint.setFunction':
      case 'debug.breakpoint.setData':
        return {
          sessionId,
          response: {
            breakpoints: [
              {
                id: 1,
                verified: true,
                source: {
                  name: 'app.ts',
                  path: 'Q:\\fixture\\app.ts',
                  checksums: [{ algorithm: 'SHA256', checksum: 'abc123' }],
                },
                line: 2,
              },
            ],
          },
        };
      case 'debug.breakpoint.setException':
        return { sessionId, filters: ['all'] };
      case 'debug.execution.continue':
        return { sessionId, threadId: 7, action: 'continue', snapshot };
      case 'debug.execution.stepOver':
        return { sessionId, threadId: 7, action: 'next', snapshot };
      case 'debug.execution.stepInto':
        return { sessionId, threadId: 7, action: 'stepIn', snapshot };
      case 'debug.execution.stepOut':
        return { sessionId, threadId: 7, action: 'stepOut', snapshot };
      case 'debug.execution.pause':
        return { sessionId, threadId: 7, action: 'pause', snapshot };
      case 'debug.execution.reverseContinue':
        return { sessionId, threadId: 7, action: 'reverseContinue', snapshot };
      case 'debug.execution.restartFrame':
        return { sessionId, frameId: 11 };
      case 'debug.execution.setNextStatement':
        return { sessionId, threadId: 7, file: 'Q:\\fixture\\app.ts', line: 3 };
      case 'debug.inspect.evaluate':
        return {
          sessionId,
          result: '42',
          type: 'number',
          variablesReference: 0,
          snapshot,
        };
      case 'debug.inspect.variables':
        return {
          sessionId,
          variablesReference: 1,
          variables: [
            {
              name: 'object',
              value: 'Object',
              type: 'object',
              variablesReference: 2,
              children: [{ name: 'answer', value: '42', type: 'number' }],
            },
          ],
        };
      case 'debug.inspect.callStack':
        return {
          sessionId,
          threadId: 7,
          stackFrames: [
            {
              id: 11,
              name: 'main',
              source: 'Q:\\fixture\\app.ts',
              line: 2,
              column: 1,
              moduleId: 'fixture',
            },
            {
              id: 12,
              name: 'bootstrap',
              source: 'Q:\\fixture\\bootstrap.ts',
              line: 1,
              column: 1,
            },
          ],
        };
      case 'debug.inspect.threads':
        return { sessionId, threads: [{ id: 7, name: 'Main Thread' }] };
      case 'debug.inspect.scopes':
        return {
          sessionId,
          frameId: 11,
          scopes: [
            {
              name: 'Locals',
              presentationHint: 'locals',
              variablesReference: 1,
              expensive: false,
              source: { name: 'app.ts', path: 'Q:\\fixture\\app.ts' },
              line: 2,
              column: 1,
            },
          ],
        };
      case 'debug.watch.manage':
        return { sessionId, action: invocation.input.action, watches: snapshot.watches, snapshot };
      case 'debug.inspect.loadedSources':
        return {
          sessionId,
          sources: [
            {
              name: 'app.ts',
              path: 'Q:\\fixture\\app.ts',
              presentationHint: 'normal',
              origin: 'workspace',
            },
          ],
          snapshot,
        };
      case 'debug.inspect.modules':
        return {
          sessionId,
          modules: {
            modules: [
              {
                id: 'fixture',
                name: 'fixture.dll',
                path: 'Q:\\fixture\\fixture.dll',
                isOptimized: false,
                isUserCode: true,
                version: '1.0.0',
              },
            ],
            totalModules: 1,
          },
        };
      case 'debug.inspect.exceptionInfo':
        return {
          sessionId,
          threadId: 7,
          exception: {
            exceptionId: 'System.InvalidOperationException',
            description: 'Fixture exception',
            breakMode: 'always',
            details: {
              message: 'outer',
              typeName: 'InvalidOperationException',
              innerException: [{ message: 'inner', typeName: 'Exception' }],
            },
          },
        };
      default:
        throw new Error(`Unhandled strict-host capability: ${invocation.capability}`);
    }
  }

  async readSource(_scope, sessionId, sourcePath) {
    this.requireSession(sessionId);
    return {
      path: sourcePath,
      name: path.basename(sourcePath),
      language: 'typescript',
      content: 'const answer = 42;',
    };
  }

  subscribe(_scope, sessionId, listener) {
    const listeners = this.listeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    return () => listeners.delete(listener);
  }

  emit(sessionId) {
    const event = {
      sessionId,
      type: 'stopped',
      occurredAt: '2026-08-16T16:01:00.000Z',
      body: { reason: 'breakpoint', threadId: 7 },
      snapshot: this.requireSession(sessionId),
    };
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event);
  }
}

test('uses the strict Marshal runtime extension manifest contract', () => {
  assert.deepEqual(Object.keys(manifest).sort(), [
    'appServicesSnippet',
    'dependencies',
    'docs',
    'entrypoint',
    'examples',
    'identity',
    'moduleFormat',
    'provides',
    'resources',
    'schemaVersion',
    'version',
  ]);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.identity, packageJson.name);
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.moduleFormat, 'commonjs-bundle-v1');
  assert.match(manifest.entrypoint, /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.?\/).+\.cjs$/);
  assert.equal(packageJson.type, 'commonjs');
  assert.equal(packageJson.main, manifest.entrypoint);
  assert.deepEqual(manifest.dependencies, {
    services: [{ id: 'marshal.agentic-debugger.host-adapter' }],
  });
});

test('packs the native host and any provisioned adapters without install-time downloads', () => {
  assert.equal(packageJson.exports['./native'].import, './dist/runtime/native-host.mjs');
  assert.equal(packageJson.exports['./native'].types, './dist/types/runtime/native-host.d.ts');
  assert.ok(packageJson.files.includes('dist'));
  assert.ok(packageJson.files.includes('adapters'));
  assert.equal(packageJson.scripts.prepack, 'npm run build');
  assert.equal(packageJson.scripts.postinstall, undefined);
  assert.equal(packageJson.scripts['provision:adapters'], 'node scripts/postinstall.mjs');
});

test('ships a native host graph with only Node builtins external', () => {
  const distRoot = path.join(repositoryRoot, 'dist');
  const nativeEntrypoint = path.resolve(
    repositoryRoot,
    packageJson.exports['./native'].import,
  );
  const pending = [nativeEntrypoint];
  const visited = new Set();

  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (visited.has(modulePath)) continue;
    visited.add(modulePath);
    assert.ok(existsSync(modulePath), `Missing native module: ${modulePath}`);

    const source = readFileSync(modulePath, 'utf8');
    const specifiers = source.matchAll(
      /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    );
    for (const match of specifiers) {
      const specifier = match[1];
      if (specifier.startsWith('.')) {
        const dependencyPath = path.resolve(path.dirname(modulePath), specifier);
        assert.ok(
          path.relative(distRoot, dependencyPath).split(path.sep)[0] !== '..',
          `Native dependency escapes dist: ${specifier}`,
        );
        pending.push(dependencyPath);
      } else {
        assert.ok(
          NODE_BUILTINS.has(specifier),
          `Native host leaves non-builtin dependency external: ${specifier}`,
        );
      }
    }
  }
});

test('loads the self-contained native host entrypoint', async () => {
  const nativeEntrypoint = path.resolve(
    repositoryRoot,
    packageJson.exports['./native'].import,
  );
  const nativeHost = await import(pathToFileURL(nativeEntrypoint).href);
  assert.equal(typeof nativeHost.NativeDebuggerHostAdapter, 'function');
  assert.ok(new nativeHost.NativeDebuggerHostAdapter());
});

test('ships a loadable CommonJS activation entrypoint', () => {
  const entrypointPath = path.join(repositoryRoot, ...manifest.entrypoint.split('/'));
  assert.ok(existsSync(entrypointPath), `Missing extension entrypoint: ${manifest.entrypoint}`);
  assert.ok(statSync(entrypointPath).size > 0, 'Extension entrypoint must not be empty.');
  const require = createRequire(import.meta.url);
  const extension = require(entrypointPath);
  assert.equal(typeof extension.activate, 'function');
});

test(
  'registers the built extension and validates real handler-shaped outputs with Marshal core',
  { skip: !existsSync(marshalCoreEntrypoint) && 'Marshal runtime core is not available' },
  async () => {
    const core = await import(pathToFileURL(marshalCoreEntrypoint).href);
    const entrypointPath = path.join(repositoryRoot, ...manifest.entrypoint.split('/'));
    const require = createRequire(import.meta.url);
    const extension = require(entrypointPath);
    const host = new StrictContractHost();
    const restore = extension.registerRuntimeDebuggerHostAdapter(host);
    let activation;
    try {
      const activationContext = {
        manifest,
        search: async () => ({}),
        execute: async () => ({
          protocolVersion: '1.0.0',
          status: 'success',
          result: {
            output: {
              value: {
                instance: {
                  instanceId: 'debugger-ui-1',
                },
              },
            },
          },
          receipt: {},
        }),
      };
      activation = await extension.activate(activationContext);
      const provider = activation.capabilityProviders?.[0];
      assert.ok(provider);

      const kernel = new core.RuntimeKernel({
        permissionBroker: {
          decide(check) {
            assert.deepEqual(
              check.requirements.map((requirement) => requirement.permission),
              [`marshal.tool.invoke:${check.capability.name}`],
            );
            return {
              decision: 'allow',
              reason: 'Accepted the capability-scoped Marshal invocation permission.',
            };
          },
        },
      });
      kernel.register(provider);
      const baseContext = {
        principal: { id: 'agent-1', kind: 'agent' },
        scope: { sessionId: 'marshal-session-1', chatId: 'chat-1' },
        metadata: { marshalWorkspaceName: 'workspace-1' },
      };
      const descriptors = await kernel.list({
        ...baseContext,
        executionId: 'list-descriptors',
      });
      assert.equal(descriptors.length, 36);
      for (const descriptor of descriptors) {
        assert.deepEqual(descriptor.permissions, [
          {
            permission: `marshal.tool.invoke:${descriptor.name}`,
            risk: descriptor.permissions?.[0]?.risk,
          },
        ]);
        assert.equal(descriptor.outputSchema.type, 'object');
        assert.equal(descriptor.outputSchema.additionalProperties, false);
        assert.ok(descriptor.outputSchema.properties);
      }

      const outputs = new Map();
      let executionSequence = 0;
      const execute = async (name, input) => {
        const result = await kernel.runtimeExec(
          {
            protocolVersion: core.RUNTIME_PROTOCOL_VERSION,
            target: name,
            input,
          },
          { ...baseContext, executionId: `strict-output-${++executionSequence}` },
        );
        assert.equal(
          result.status,
          'success',
          `${name}: ${result.error?.code ?? ''} ${result.error?.message ?? ''}`,
        );
        assert.ok(result.result);
        outputs.set(name, result.result.output);
        return result.result.output;
      };

      const launched = await execute('debug.session.launch', {
        program: 'Q:\\fixture\\app.ts',
        language: 'typescript',
      });
      const sessionId = launched.value.sessionId;
      await execute('debug.session.attach', {
        language: 'typescript',
        host: '127.0.0.1',
        port: 9229,
      });
      await execute('debug.adapter.list', {});
      await execute('debug.session.list', {});
      await execute('debug.session.get', { sessionId });
      host.emit(sessionId);
      await execute('debug.session.events', { sessionId, after: 0, limit: 10 });
      await execute('debug.source.read', { sessionId, path: 'Q:\\fixture\\app.ts' });
      await execute('debug.ui.selectExecutionBlock', {
        sessionId,
        executionBlockId: 'strict-selected-block',
      });
      await execute('debug.session.restart', { sessionId });
      await execute('debug.breakpoint.set', {
        sessionId,
        file: 'Q:\\fixture\\app.ts',
        line: 2,
      });
      await execute('debug.breakpoint.remove', { sessionId, breakpointId: 'bp-1' });
      await execute('debug.breakpoint.setFunction', { sessionId, name: 'main' });
      await execute('debug.breakpoint.setException', { sessionId, filters: ['all'] });
      await execute('debug.breakpoint.setData', { sessionId, dataId: 'answer' });
      await execute('debug.breakpoint.list', { sessionId });
      await execute('debug.breakpoint.enable', { sessionId, breakpointId: 'bp-1' });
      await execute('debug.breakpoint.disable', { sessionId, breakpointId: 'bp-1' });
      await execute('debug.execution.continue', { sessionId, threadId: 7 });
      await execute('debug.execution.stepOver', { sessionId, threadId: 7 });
      await execute('debug.execution.stepInto', { sessionId, threadId: 7 });
      await execute('debug.execution.stepOut', { sessionId, threadId: 7 });
      await execute('debug.execution.pause', { sessionId, threadId: 7 });
      await execute('debug.execution.setNextStatement', {
        sessionId,
        file: 'Q:\\fixture\\app.ts',
        line: 3,
        threadId: 7,
      });
      await execute('debug.execution.restartFrame', { sessionId, frameId: 11 });
      await execute('debug.execution.reverseContinue', { sessionId, threadId: 7 });
      await execute('debug.inspect.evaluate', { sessionId, expression: 'answer' });
      await execute('debug.inspect.variables', { sessionId, variablesReference: 1 });
      const callStackOutput = await execute('debug.inspect.callStack', { sessionId, threadId: 7 });
      assert.deepEqual(
        callStackOutput.value.stackFrames.map((frame) => frame.source),
        ['Q:\\fixture\\app.ts', 'Q:\\fixture\\bootstrap.ts'],
      );
      await execute('debug.inspect.threads', { sessionId });
      await execute('debug.inspect.scopes', { sessionId, frameId: 11 });
      await execute('debug.watch.manage', { sessionId, action: 'list' });
      await execute('debug.inspect.loadedSources', { sessionId });
      await execute('debug.inspect.modules', { sessionId });
      await execute('debug.inspect.exceptionInfo', { sessionId, threadId: 7 });

      const disconnectLaunch = await execute('debug.session.launch', {
        program: 'Q:\\fixture\\disconnect.ts',
      });
      await execute('debug.session.disconnect', {
        sessionId: disconnectLaunch.value.sessionId,
      });
      const terminateLaunch = await execute('debug.session.launch', {
        program: 'Q:\\fixture\\terminate.ts',
      });
      await execute('debug.session.terminate', {
        sessionId: terminateLaunch.value.sessionId,
      });

      assert.deepEqual(
        [...new Set(descriptors.map((descriptor) => descriptor.name))].sort(),
        [...outputs.keys()].sort(),
      );

      const descriptorsByName = new Map(
        descriptors.map((descriptor) => [descriptor.name, descriptor]),
      );
      for (const [capability, nativeAction] of EXECUTION_CONTROL_ACTIONS) {
        const descriptor = descriptorsByName.get(capability);
        const nativeOutput = outputs.get(capability);
        assert.ok(descriptor);
        assert.ok(nativeOutput);
        assert.equal(nativeOutput.value.action, nativeAction);
        core.assertRuntimeOutputSchema(
          {
            ...nativeOutput,
            value: {
              sessionId: nativeOutput.value.sessionId,
              action: capability,
              snapshot: nativeOutput.value.snapshot,
            },
          },
          descriptor.outputSchema,
        );
      }
      const callStackDescriptor = descriptorsByName.get('debug.inspect.callStack');
      assert.ok(callStackDescriptor);
      core.assertRuntimeOutputSchema(
        {
          ...callStackOutput,
          value: {
            ...callStackOutput.value,
            stackFrames: [
              {
                ...callStackOutput.value.stackFrames[0],
                source: {
                  name: 'app.ts',
                  path: 'Q:\\fixture\\app.ts',
                  sourceReference: 0,
                  adapterData: null,
                  sources: [{ name: 'generated.ts', path: 'Q:\\fixture\\generated.ts' }],
                },
              },
            ],
          },
        },
        callStackDescriptor.outputSchema,
      );
      const uiApplication = activation.uiApplications?.[0];
      assert.ok(uiApplication);
      const openPayload = {
        sessionId: 'marshal-session-1',
        workspaceName: 'workspace-1',
        extensionId: '@marshal/agentic-debugger-extension',
        applicationId: uiApplication.id,
        surface: 'inline-card',
        content: {
          kind: 'application',
          descriptor: uiApplication,
        },
        idempotencyKey: 'debugger-ui-open-1',
      };
      assert.ok(
        Buffer.byteLength(JSON.stringify(openPayload), 'utf8') <= MARSHAL_UI_MAX_BYTES,
        'Packed UI application open payload exceeds the Marshal byte limit.',
      );
      assert.ok(
        maximumJsonDepth(openPayload) <= MARSHAL_UI_MAX_DEPTH,
        'Packed UI application open payload exceeds the Marshal depth limit.',
      );

      const application = uiApplication.application;
      assert.ok(application);
      for (const action of application.actions) {
        const descriptor = descriptorsByName.get(action.target.capability);
        assert.ok(descriptor, `Missing descriptor for UI action ${action.id}`);
        assert.deepEqual(
          action.requiredPermissions,
          descriptor.permissions.map((requirement) => requirement.permission),
        );
        assert.notDeepEqual(action.outputSchema, descriptor.outputSchema);
        assert.equal(descriptor.outputSchema.$defs !== undefined, true);
        assert.equal(action.outputSchema.$defs, undefined);
        core.assertRuntimeOutputSchema(outputs.get(action.target.capability), action.outputSchema);
      }
      for (const tool of application.tools) {
        const descriptor = descriptorsByName.get(tool.name);
        assert.ok(descriptor, `Missing descriptor for UI tool ${tool.id}`);
        assert.notDeepEqual(tool.outputSchema, descriptor.outputSchema);
        assert.equal(descriptor.outputSchema.$defs !== undefined, true);
        assert.equal(tool.outputSchema.$defs, undefined);
        core.assertRuntimeOutputSchema(outputs.get(tool.name), tool.outputSchema);
      }
    } finally {
      await activation?.dispose?.();
      restore();
    }
  },
);
