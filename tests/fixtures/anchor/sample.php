<?php
namespace App;
class Foo {
    public function bar(int $a): int { if ($a) { foreach ([1] as $x) { return $x; } } return 0; }
    public function baz(): array { return array_map(function ($v) { return $v; }, array_map(fn($v) => $v, [1])); }
}
function top(): int { return 1; }
