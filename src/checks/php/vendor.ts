import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ResolvedConfig } from "../../core/config/types.ts";
import type { Applicability } from "../../core/types.ts";

export function requireVendor(config: ResolvedConfig): Applicability {
  if (existsSync(join(config.root, "vendor", "autoload.php"))) return { kind: "run" };
  return {
    kind: "error",
    message: "PHP unused checks need installed Composer dependencies: run `composer install` "
      + "(workflow input `setup: composer install`) and retry.",
  };
}
