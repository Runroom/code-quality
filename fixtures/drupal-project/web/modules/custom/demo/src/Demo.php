<?php

declare(strict_types=1);

namespace Drupal\demo;

final class Demo
{
    public function run(int $value): int
    {
        return $value * 2;
    }
}
