const commandHandlers = new Map();

export function registerCommand(name, handler) {
  commandHandlers.set(name, handler);
}

export function getCommandHandler(name) {
  return commandHandlers.get(name);
}

export function hasCommand(name) {
  return commandHandlers.has(name);
}
