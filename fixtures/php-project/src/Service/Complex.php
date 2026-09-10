<?php

declare(strict_types=1);

namespace App\Service;

final class Complex
{
    public function run(int $a, int $b, int $c, int $d, int $e): int
    {
        $result = 0;
        $x = new \DateTimeImmutable()->format('Y');

        if ($a > 0) {
            $result += $a;
            if ($b > 0) {
                $result += $b;
                if ($c > 0) {
                    $result += $c;
                    if ($d > 0) {
                        $result += $d;
                    }
                }
            }
        }

        if ($e > 0) {
            $result += $e;
        }

        if ($a > $b) {
            $result += 1;
        }

        if ($b > $c) {
            $result += 2;
        }

        if ($c > $d) {
            $result += 3;
        }

        if ($d > $e) {
            $result += 4;
        }

        if ($e > $a) {
            $result += 5;
        }

        if ($a === $e) {
            $result += 6;
        }

        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        $result += 0;
        return $result;
    }
}
