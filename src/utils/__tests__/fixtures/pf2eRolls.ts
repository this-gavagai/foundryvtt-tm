// Real serialized roll JSON, captured verbatim from a live game:
//   Foundry VTT 14.363, PF2e 8.2.0
// checkRollNat1 comes from the test world's message log; the DamageRolls were
// evaluated in the client console (new DamageRoll(formula).evaluate()) and
// serialized with roll.toJSON() — exactly the shape message.rolls[] carries.
// These pin rollSummary against genuine system output so a PF2e serialization
// change breaks a test here before it breaks the chat overlay.

export const damageSimple =
  '{"class":"DamageRoll","options":{"showBreakdown":true},"dice":[],"formula":"{2d6[fire]}","terms":[{"class":"InstancePool","options":{},"evaluated":true,"terms":["2d6[fire]"],"modifiers":[],"rolls":[{"class":"DamageInstance","options":{"flavor":"fire"},"dice":[],"formula":"2d6[fire]","terms":[{"class":"Die","options":{"flavor":"fire"},"evaluated":true,"number":2,"faces":6,"modifiers":[],"results":[{"result":6,"active":true},{"result":2,"active":true}]}],"total":8,"evaluated":true}],"results":[{"result":8,"active":true}]}],"total":8,"evaluated":true}'

export const damageMultiInstance =
  '{"class":"DamageRoll","options":{"showBreakdown":true},"dice":[],"formula":"{(2d6 + 4)[fire],1d4[persistent,acid]}","terms":[{"class":"InstancePool","options":{},"evaluated":true,"terms":["(2d6 + 4)[fire]","1d4[persistent,acid]"],"modifiers":[],"rolls":[{"class":"DamageInstance","options":{"flavor":"fire"},"dice":[],"formula":"(2d6 + 4)[fire]","terms":[{"class":"Grouping","options":{"flavor":"fire"},"evaluated":true,"term":{"class":"ArithmeticExpression","options":{},"evaluated":true,"operator":"+","operands":[{"class":"Die","options":{},"evaluated":true,"number":2,"faces":6,"modifiers":[],"results":[{"result":6,"active":true},{"result":3,"active":true}]},{"class":"NumericTerm","options":{},"evaluated":true,"number":4}]}}],"total":13,"evaluated":true},{"class":"DamageInstance","options":{"flavor":"persistent,acid"},"dice":[],"formula":"1d4[persistent,acid]","terms":[{"class":"Die","options":{"flavor":"persistent,acid"},"evaluated":true,"number":1,"faces":4,"modifiers":[],"results":[{"result":4,"active":true,"hidden":true}]}],"total":4,"evaluated":true}],"results":[{"result":13,"active":true},{"result":0,"active":true}]}],"total":13,"evaluated":true}'

export const damageHealing =
  '{"class":"DamageRoll","options":{"showBreakdown":true},"dice":[],"formula":"{2d8[healing]}","terms":[{"class":"InstancePool","options":{},"evaluated":true,"terms":["2d8[healing]"],"modifiers":[],"rolls":[{"class":"DamageInstance","options":{"flavor":"healing"},"dice":[],"formula":"2d8[healing]","terms":[{"class":"Die","options":{"flavor":"healing"},"evaluated":true,"number":2,"faces":8,"modifiers":[],"results":[{"result":2,"active":true},{"result":2,"active":true}]}],"total":4,"evaluated":true}],"results":[{"result":4,"active":true}]}],"total":4,"evaluated":true}'

export const damageUntyped =
  '{"class":"DamageRoll","options":{"showBreakdown":true},"dice":[],"formula":"{3d8 + 2}","terms":[{"class":"InstancePool","options":{},"evaluated":true,"terms":["3d8 + 2"],"modifiers":[],"rolls":[{"class":"DamageInstance","options":{"flavor":"damage,healing"},"dice":[],"formula":"3d8 + 2","terms":[{"class":"ArithmeticExpression","options":{},"evaluated":true,"operator":"+","operands":[{"class":"Die","options":{},"evaluated":true,"number":3,"faces":8,"modifiers":[],"results":[{"result":7,"active":true},{"result":6,"active":true},{"result":3,"active":true}]},{"class":"NumericTerm","options":{},"evaluated":true,"number":2}]}],"total":18,"evaluated":true}],"results":[{"result":18,"active":true}]}],"total":18,"evaluated":true}'

export const checkRollNat1 =
  '{"class":"CheckRoll","options":{"type":"saving-throw","identifier":"tm_background","action":null,"dice":"1d20","domains":["reflex","dex-based","saving-throw","all","check","reflex-check"],"isReroll":true,"totalModifier":12,"damaging":false,"rollerId":"jcwWmhDNRnljzAPn","showBreakdown":true},"dice":[],"formula":"1d20 + 12","terms":[{"class":"Die","options":{"flavor":null},"evaluated":true,"number":1,"faces":20,"modifiers":[],"results":[{"result":1,"active":true}]},{"class":"OperatorTerm","options":{},"evaluated":true,"operator":"+"},{"class":"NumericTerm","options":{"flavor":null},"evaluated":true,"number":12}],"total":13,"evaluated":true}'
