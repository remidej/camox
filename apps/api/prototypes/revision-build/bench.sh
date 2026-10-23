#!/bin/sh
# PROTOTYPE, throwaway (issue #550). For each size and variant: one cold build in a new sandbox,
# then two warm builds in the same one, then destroy it. ROUNDS times.
U=https://prototype-550-revision-build.remidej.workers.dev
for round in $(seq 1 ${ROUNDS:-2}); do for s in ${SIZES:-2 4}; do for v in ${VARIANTS:-tpl grown}; do
  box="b$round-s$s-$v-$(date +%s)"
  for r in 1 2 3; do
    out=$(curl -s -m 900 -X POST "$U/build?size=$s&variant=$v&box=$box&rev=$box-r$r")
    echo "round=$round size=standard-$s variant=$v run=$r $out" | cut -c 1-700
  done
  curl -s -X POST "$U/destroy?size=$s&box=$box" >/dev/null
done; done; done
