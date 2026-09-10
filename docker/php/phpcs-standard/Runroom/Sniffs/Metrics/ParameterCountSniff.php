<?php

declare(strict_types=1);

namespace Runroom\Sniffs\Metrics;

use PHP_CodeSniffer\Files\File;
use PHP_CodeSniffer\Sniffs\Sniff;

final class ParameterCountSniff implements Sniff
{
    public int $maxParameters = 4;

    /** @return array<int> */
    public function register(): array
    {
        return [T_FUNCTION, T_CLOSURE, T_FN];
    }

    public function process(File $phpcsFile, $stackPtr): void
    {
        $count = count($phpcsFile->getMethodParameters($stackPtr));
        if ($count <= $this->maxParameters) {
            return;
        }

        $name = $phpcsFile->getDeclarationName($stackPtr) ?? 'closure';
        $phpcsFile->addWarning(
            sprintf(
                'Function "%s" has %d parameters; the limit is %d',
                $name,
                $count,
                $this->maxParameters,
            ),
            $stackPtr,
            'TooMany',
        );
    }
}
