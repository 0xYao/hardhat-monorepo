import { expect } from 'chai';
import { BigNumber, utils, Wallet } from 'ethers';
import { JsonRpcSigner } from '@ethersproject/providers';
import { evm, wallet } from '@test-utils';
import { then, when } from '@test-utils/bdd';
import { getNodeUrl } from '@utils/network';
import { IERC20, ISwapper, TradeFactory } from '@typechained';
import forkBlockNumber from '@integration/fork-block-numbers';
import bancor, { SwapResponse } from '@scripts/libraries/dexes/bancor';
import * as setup from '../setup';

const AMOUNT_IN = utils.parseEther('69.420');

describe('Bancor', function () {
  let yMech: JsonRpcSigner;
  let strategy: Wallet;
  let tradeFactory: TradeFactory;
  let swapper: ISwapper;

  let BNT: IERC20;
  let USDC: IERC20;

  let snapshotId: string;

  let bancorResponse: SwapResponse;

  when('on mainnet', () => {
    const FORK_BLOCK_NUMBER = forkBlockNumber['mainnet-bancor-swapper'];

    const CHAIN_ID = 1;

    const BNT_ADDRESS = '0x1f573d6fb3f13d689ff844b4ce37794d79a7ff1c';
    const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

    const BNT_WHALE_ADDRESS = '0xf977814e90da44bfa03b6295a0616a897441acec';

    before(async () => {
      strategy = await wallet.generateRandom();

      await evm.reset({
        jsonRpcUrl: getNodeUrl('mainnet'),
        blockNumber: FORK_BLOCK_NUMBER,
      });

      ({
        fromToken: BNT,
        toToken: USDC,
        tradeFactory,
        yMech,
        swapper,
      } = await setup.async({
        chainId: CHAIN_ID,
        fixture: ['Common', 'Mainnet', 'Bancor'],
        swapper: 'AsyncBancor',
        fromTokenAddress: BNT_ADDRESS,
        toTokenAddress: USDC_ADDRESS,
        fromTokenWhaleAddress: BNT_WHALE_ADDRESS,
        strategy,
      }));

      bancorResponse = await bancor.swap({
        tokenIn: BNT_ADDRESS,
        tokenOut: USDC_ADDRESS,
        amountIn: AMOUNT_IN,
        slippage: 5,
      });

      snapshotId = await evm.snapshot.take();
    });

    beforeEach(async () => {
      await evm.snapshot.revert(snapshotId);
    });

    describe('swap', () => {
      let preSwapBalance: BigNumber;
      beforeEach(async () => {
        preSwapBalance = await BNT.balanceOf(strategy.address);
        await tradeFactory.connect(yMech)['execute((address,address,address,uint256,uint256),address,bytes)'](
          {
            _strategy: strategy.address,
            _tokenIn: BNT_ADDRESS,
            _tokenOut: USDC_ADDRESS,
            _amount: AMOUNT_IN,
            _minAmountOut: bancorResponse.minAmountOut!,
          },
          swapper.address,
          bancorResponse.data
        );
      });

      then('BNT gets taken from strategy', async () => {
        expect(await BNT.balanceOf(strategy.address)).to.equal(preSwapBalance.sub(AMOUNT_IN));
      });
      then('USDC gets airdropped to strategy', async () => {
        expect(await USDC.balanceOf(strategy.address)).to.be.gt(0);
      });
    });
  });
});
