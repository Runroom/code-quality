<?php

declare(strict_types=1);

namespace App\Service;

final class Dead
{
    public function alive(): string
    {
        return 'alive';
    }

    private function never(): string
    {
        return 'dead';
    }
}
