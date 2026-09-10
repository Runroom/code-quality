import { describe, expect, it } from "vitest";

import { xml } from "../../../src/checks/shared/xml.ts";

describe("xml", () => {
  it("builds escaped leaf and parent elements", () => {
    const child = xml("rule", { ref: 'a&"b' });
    expect(xml("ruleset", {}, [child])).toBe(
      '<ruleset><rule ref="a&amp;&quot;b"/></ruleset>',
    );
  });
});
