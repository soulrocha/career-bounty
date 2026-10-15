import { loadSettings } from '../config.mjs';
import { ensureSkeleton, resolveDataRoot } from '../store/dataRoot.mjs';

export const commands = {
  async doctor() {
    const settings = await loadSettings();
    return { result: { dataRoot: settings.dataRoot, ok: true } };
  },
  async setup() {
    const dataRoot = resolveDataRoot();
    const created = await ensureSkeleton(dataRoot);
    return { result: { dataRoot, created, ok: true } };
  },
};
