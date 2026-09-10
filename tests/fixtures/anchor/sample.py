class Foo:
    def bar(self, a):
        if a:
            for x in [1]:
                return x
        return 0

    @staticmethod
    def baz():
        return list(map(lambda v: v, map(lambda v: v + 1, [1])))

def top():
    return 1
