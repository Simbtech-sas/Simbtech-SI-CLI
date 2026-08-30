/**
 * What the web UI imports.
 *
 * A barrel rather than deep paths, so the pure operations stay the public
 * surface and `main.ts` — which is a CLI with an argv parser and a process exit
 * — stays out of a bundler's way.
 */
export {
  addNode,
  disruptionWarning,
  nextNodeName,
  renderInventory,
  DEFAULT_SETTINGS,
  type AddNodeInput,
  type ClusterNode,
  type ClusterSettings,
  type NodeRole,
} from './cluster/inventory.ts';

export {
  generateService,
  generateToolService,
  generateLoadBalancing,
  type GeneratedFile,
  type LoadBalancing,
  type ServiceSpec,
  type ToolDeploySpec,
} from './services/generate.ts';

export { loadState, saveState, REPO, STATE_FILE, type State } from './state.ts';
