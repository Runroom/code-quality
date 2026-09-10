<?php

declare(strict_types=1);

namespace App\Domain;

use App\Infrastructure\Repo;

final class Entity
{
    public function save(Repo $repo): void
    {
        $repo->store($this);
    }
}
