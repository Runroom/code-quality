# code-quality — run these through make; `$$PWD` is Make escaping for `$PWD`
CODE_QUALITY_IMAGE ?= ghcr.io/runroom/code-quality:v1
# Must be a single image reference; it is interpolated into docker run unquoted.
CODE_QUALITY = docker run --rm -v "$$PWD:/work" $(CODE_QUALITY_IMAGE)

.PHONY: quality quality-all quality-baseline quality-report quality-doctor

quality:
	$(CODE_QUALITY) check

quality-all:
	$(CODE_QUALITY) check --all

quality-baseline:
	$(CODE_QUALITY) baseline

quality-report:
	$(CODE_QUALITY) report

quality-doctor:
	$(CODE_QUALITY) doctor
