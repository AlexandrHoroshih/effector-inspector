import {
  Store,
  Event,
  Effect,
  CompositeName,
  createEvent,
  createStore,
  forward,
  createEffect,
} from 'effector';
import { using } from 'forest';
import { StyledRoot } from 'foliage';

import {
  EffectCreator,
  EffectMeta,
  EventCreator,
  EventMeta,
  Inspector,
  LogMeta,
  Options,
  StoreCreator,
  StoreMeta,
} from './types.h';
import { Root } from './view';

const storeAdd = createEvent<StoreCreator>();
const storeUpdated = createEvent<{ name: string; value: any }>();
const $stores = createStore<Record<string, StoreMeta>>({});

const eventAdd = createEvent<EventCreator>();
const eventTriggered = createEvent<{ name: string; params: any }>();
const $events = createStore<Record<string, EventMeta>>({});

const effectAdd = createEvent<EffectCreator>();
const effectTriggered = createEvent<{ sid: string }>();
const $effects = createStore<Record<string, EffectMeta>>({});

const $logs = createStore<LogMeta[]>([]);

$stores
  .on(storeAdd, (map, payload) => ({
    ...map,
    [payload.name]: {
      value: payload.store.getState(),
      mapped: payload.mapped,
    },
  }))
  .on(storeUpdated, (map, { name, value }) => {
    // should not change the order of fields
    map[name] = { ...map[name], value };
    return { ...map };
  });

$events
  .on(eventAdd, (map, payload) => ({
    ...map,
    [payload.name]: {
      mapped: payload.mapped,
      lastTriggeredWith: undefined,
    },
  }))
  .on(eventTriggered, (map, { name, params }) => {
    // should not change the order of fields
    map[name] = { ...map[name], lastTriggeredWith: params };
    return { ...map };
  });

$effects
  .on(effectAdd, (map, effect) => ({
    ...map,
    [effect.sid]: {
      name: effect.name,
      effect: effect.effect,
      inFlight: effect.effect.inFlight.getState(),
    },
  }))
  .on(effectTriggered, (map, { sid }) => {
    const fx = map[sid];
    map[sid] = {
      ...fx,
      inFlight: fx.effect.inFlight.getState(),
    };
    return { ...map };
  });

let id = 1e3;
const nextId = () => (++id).toString(36);

const createRecordFx = createEffect<
  Pick<LogMeta, 'name' | 'kind' | 'payload'>,
  LogMeta
>({
  handler({ name, kind, payload }) {
    return {
      id: nextId(),
      kind,
      name,
      payload,
      datetime: new Date(),
    };
  },
});

forward({
  from: eventTriggered,
  to: createRecordFx.prepend(({ name, params }) => ({
    kind: 'event',
    name,
    payload: params,
  })),
});

forward({
  from: storeUpdated,
  to: createRecordFx.prepend(({ name, value }) => ({
    kind: 'store',
    name,
    payload: value,
  })),
});

$logs.on(createRecordFx.doneData, (logs, record) => [record, ...logs]);

export function createInspector(options: Options = {}): Inspector {
  const root = document.createElement('div');
  root.classList.add('effector-inspector');

  document.body.append(root);

  using(root, () => Root($stores, $events, $effects, $logs, options.visible));
  using(root, StyledRoot);

  return { root };
}

export function addStore(
  store: Store<any>,
  options: { mapped?: boolean; name?: string } = {},
): void {
  const name = options.name || createName(store);

  storeAdd({ store, name, mapped: options.mapped || false });

  forward({
    from: store.updates.map((value) => ({ name, value })),
    to: storeUpdated,
  });
}

export function addEvent(
  event: Event<any>,
  options: { mapped?: boolean; name?: string } = {},
): void {
  const name = options.name || createName(event);

  eventAdd({ event, name, mapped: options.mapped || false });

  forward({
    from: event.map((params) => ({
      name,
      params,
    })),
    to: eventTriggered,
  });
}

export function addEffect(
  effect: Effect<any, any, any>,
  options: { attached?: boolean; sid?: string } = {},
) {
  const name = createName(effect);
  const sid = options.sid || effect.sid || name;

  effectAdd({ effect, name, sid, attached: options.attached ?? false });

  forward({
    from: [effect, effect.finally],
    to: effectTriggered.prepend(() => ({ sid })),
  });

  forward({
    from: [
      effect.map((params) => ({
        kind: 'effect',
        name,
        payload: params,
      })),
      effect.done.map((params) => ({
        kind: 'effect',
        name: name + '.done',
        payload: params,
      })),
      effect.fail.map((params) => ({
        kind: 'effect',
        name: name + '.fail',
        payload: params,
      })),
    ],
    to: createRecordFx,
  });
}

function createName<T extends { compositeName: CompositeName }>(
  unit: T,
): string {
  return unit.compositeName.path.join('/');
}
