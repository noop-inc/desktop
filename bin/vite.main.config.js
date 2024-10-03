"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfig = void 0;
const vite_1 = require("vite");
const vite_base_config_1 = require("./vite.base.config");
function getConfig(forgeEnv) {
    const { forgeConfigSelf } = forgeEnv;
    const define = (0, vite_base_config_1.getBuildDefine)(forgeEnv);
    const config = {
        build: {
            lib: {
                entry: forgeConfigSelf.entry,
                fileName: () => '[name].js',
                formats: ['es'],
            },
            rollupOptions: {
                external: vite_base_config_1.external,
            },
        },
        plugins: [(0, vite_base_config_1.pluginHotRestart)('restart')],
        define,
        resolve: {
            // Load the Node.js entry.
            conditions: ['node'],
            mainFields: ['module', 'jsnext:main', 'jsnext'],
        },
    };
    return (0, vite_1.mergeConfig)((0, vite_base_config_1.getBuildConfig)(forgeEnv), config);
}
exports.getConfig = getConfig;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidml0ZS5tYWluLmNvbmZpZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jb25maWcvdml0ZS5tYWluLmNvbmZpZy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwrQkFBb0U7QUFFcEUseURBQWdHO0FBRWhHLFNBQWdCLFNBQVMsQ0FBQyxRQUE0QjtJQUNwRCxNQUFNLEVBQUUsZUFBZSxFQUFFLEdBQUcsUUFBUSxDQUFDO0lBQ3JDLE1BQU0sTUFBTSxHQUFHLElBQUEsaUNBQWMsRUFBQyxRQUFRLENBQUMsQ0FBQztJQUN4QyxNQUFNLE1BQU0sR0FBZTtRQUN6QixLQUFLLEVBQUU7WUFDTCxHQUFHLEVBQUU7Z0JBQ0gsS0FBSyxFQUFFLGVBQWUsQ0FBQyxLQUFLO2dCQUM1QixRQUFRLEVBQUUsR0FBRyxFQUFFLENBQUMsV0FBVztnQkFDM0IsT0FBTyxFQUFFLENBQUMsS0FBSyxDQUFDO2FBQ2pCO1lBQ0QsYUFBYSxFQUFFO2dCQUNiLFFBQVEsRUFBUiwyQkFBUTthQUNUO1NBQ0Y7UUFDRCxPQUFPLEVBQUUsQ0FBQyxJQUFBLG1DQUFnQixFQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ3RDLE1BQU07UUFDTixPQUFPLEVBQUU7WUFDUCwwQkFBMEI7WUFDMUIsVUFBVSxFQUFFLENBQUMsTUFBTSxDQUFDO1lBQ3BCLFVBQVUsRUFBRSxDQUFDLFFBQVEsRUFBRSxhQUFhLEVBQUUsUUFBUSxDQUFDO1NBQ2hEO0tBQ0YsQ0FBQztJQUVGLE9BQU8sSUFBQSxrQkFBVyxFQUFDLElBQUEsaUNBQWMsRUFBQyxRQUFRLENBQUMsRUFBRSxNQUFNLENBQUMsQ0FBQztBQUN2RCxDQUFDO0FBeEJELDhCQXdCQyJ9