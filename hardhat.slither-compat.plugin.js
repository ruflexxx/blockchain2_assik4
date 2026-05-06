const slitherCompatPlugin = {
  id: "slither-hardhat3-compat",
  hookHandlers: {
    solidity: () => import("./hardhat.slither-compat.hooks.js"),
  },
};

export default slitherCompatPlugin;
