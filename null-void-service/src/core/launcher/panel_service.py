_base_modules = [
    "cpu",
    "ram",
    "temp",
    "power",
    "history",
]


class ModuleRegistry:
    def __init__(self):
        self._modules: list[str] = list(_base_modules)

    def register(self, module: str) -> bool:
        if module not in self._modules:
            self._modules.append(module)
            return True
        return False

    def unregister(self, module: str) -> bool:
        if module in self._modules and module not in _base_modules:
            self._modules.remove(module)
            return True
        return False

    def get_active_modules(self, user_context: dict | None = None) -> list[str]:
        return list(self._modules)

    def is_module_visible(self, module: str, user_context: dict | None = None) -> bool:
        return module in self._modules

    def get_base_modules(self) -> list[str]:
        return list(_base_modules)


_registry = ModuleRegistry()


def get_active_modules(user_context: dict | None = None) -> list[str]:
    return _registry.get_active_modules(user_context)


def is_module_visible(module: str, user_context: dict | None = None) -> bool:
    return _registry.is_module_visible(module, user_context)


def register_module(module: str) -> bool:
    return _registry.register(module)


def unregister_module(module: str) -> bool:
    return _registry.unregister(module)


def get_module_registry() -> ModuleRegistry:
    return _registry
