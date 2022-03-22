import { ethers } from 'hardhat';
import { SimpleEnabledTrade, Solver } from '../types';
import * as uniswapV2Library from '@libraries/dexes/uniswap-v2';
import zrx from '@libraries/dexes/zrx';
import { UNISWAP_V2_FACTORY, UNISWAP_V2_ROUTER } from '@deploy/mainnet-swappers/uniswap_v2';
import { shouldExecuteTrade } from '@scripts/libraries/utils/should-execute-trade';
import { IERC20Metadata__factory, TradeFactory } from '@typechained';
import { PopulatedTransaction, utils } from 'ethers';
import * as wallet from '@test-utils/wallet';
import { NETWORK_NAME_IDS, SUPPORTED_NETWORKS } from '../../../../commons/utils/network';

export default class Dexes implements Solver {
  async shouldExecuteTrade({ strategy, trade }: { strategy: string; trade: SimpleEnabledTrade }): Promise<boolean> {
    return shouldExecuteTrade({ strategy, trade });
  }

  async solve({
    strategy,
    trade,
    tradeFactory,
  }: {
    strategy: string;
    trade: SimpleEnabledTrade;
    tradeFactory: TradeFactory;
  }): Promise<PopulatedTransaction> {
    const { tokenIn: tokenInAddress, tokenOut: tokenOutAddress } = trade;
    const [zrxSwapper, tokenIn, tokenOut] = await Promise.all([
      ethers.getContract('ZRX'),
      IERC20Metadata__factory.connect(tokenInAddress, tradeFactory.signer),
      IERC20Metadata__factory.connect(tokenOutAddress, tradeFactory.signer),
    ]);

    const [inSymbol, outSymbol, amount, inDecimals] = await Promise.all([tokenIn.symbol(), tokenOut.symbol(), (await tokenIn.balanceOf(strategy)).sub(1), tokenIn.decimals()]);

    console.log('[Dexes] Total balance is', utils.formatUnits(amount, inDecimals), inSymbol);
    console.log('[Dexes] Getting', inSymbol, '=>', outSymbol, 'trade information');
    const network: SUPPORTED_NETWORKS = process.env.HARDHAT_DEPLOY_FORK as SUPPORTED_NETWORKS;
    const { data: zrxData, minAmountOut: zrxMinAmountOut } = await zrx.quote({
      chainId: NETWORK_NAME_IDS[network],
      sellToken: tokenInAddress,
      buyToken: tokenOutAddress,
      sellAmount: amount,
      slippagePercentage: 1 / 100,
      skipValidation: true,
      takerAddress: strategy,
    });

    console.log('[Dexes] Calculated min amount', utils.formatEther(zrxMinAmountOut!), outSymbol);
    const executeTx = await tradeFactory.populateTransaction['execute((address,address,address,uint256,uint256),address,bytes)'](
      {
        _strategy: strategy,
        _tokenIn: tokenInAddress,
        _tokenOut: tokenOutAddress,
        _amount: amount,
        _minAmountOut: zrxMinAmountOut!,
      },
      zrxSwapper.address,
      zrxData
    );

    if (zrxMinAmountOut!.eq(0)) throw new Error(`No ${outSymbol} tokens were received`);

    return executeTx;
  }
}
