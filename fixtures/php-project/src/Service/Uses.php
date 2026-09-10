<?php

declare(strict_types=1);

namespace App\Service;

use Composer\InstalledVersions;

final class Uses
{
    public function composerVersion(): ?string
    {
        return InstalledVersions::getVersion('composer-runtime-api');
    }
}
