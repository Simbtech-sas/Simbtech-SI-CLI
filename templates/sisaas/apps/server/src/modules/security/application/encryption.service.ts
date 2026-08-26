import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { Encryption } from './encryption';

export { Encryption } from './encryption';

/**
 * Nest wrapper around `Encryption`.
 *
 * The crypto itself lives in a decorator-free, framework-free file so it can be
 * tested by `node --test` directly and reasoned about without a DI container —
 * the same reason the licence crate in SiMICE has no Tauri dependency.
 */
@Injectable()
export class EncryptionService extends Encryption {
  constructor(config: AppConfigService) {
    super(config.encryptionKey);
  }
}
